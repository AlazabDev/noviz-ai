import pino from "pino";
import * as Sentry from "@sentry/node";
import { appConfig } from "../config/app.config";

/**
 * Recursively redacts anything that LOOKS like a secret by key name —
 * `authorization`, `api-key`, `password`, `token`, `cookie`, etc., case-
 * insensitive, at ANY depth. This exists specifically because a raw
 * axios error (the normal shape of `err` at nearly every catch block in
 * this codebase — erpnextConnector.ts, the LLM providers, tools.routes.ts,
 * reasoningEngine.ts) carries its own request config on
 * `err.config.headers` — which for THIS app's own calls routinely
 * contains the real `Authorization: Bearer <ERPNext token>` or the LLM
 * provider's own `api-key`/`Authorization` header. Before this existed,
 * passing that raw error into logger.error(msg, err, meta) put those
 * real credentials straight into local log files AND into Sentry (a
 * third-party service) — a real credential-leak found in a 2026-09-21
 * security review, not a hypothetical. Redacting by KEY NAME (rather
 * than trying to enumerate every call site that might carry a secret)
 * is what makes this safe for call sites that don't exist yet too.
 */
const SENSITIVE_KEY_RE = /(authorization|api[-_]?key|apikey|password|passwd|secret|token|cookie|set-cookie)/i;
const MAX_DEPTH = 6;

function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[Truncated]";
  if (seen.has(value as object)) return "[Circular]";
  seen.add(value as object);

  if (value instanceof Error) {
    // Keep message/name/stack as real strings (Sentry/pino both want
    // those to actually be strings for grouping/display) — but walk
    // every OTHER own property (an axios error's .config/.response
    // included) through the same redaction, since those are exactly
    // where the sensitive headers live.
    const out: Record<string, unknown> = { name: value.name, message: value.message, stack: value.stack };
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === "name" || key === "message" || key === "stack") continue;
      out[key] = redact((value as any)[key], depth + 1, seen);
    }
    return out;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? "[REDACTED]" : redact(v, depth + 1, seen);
  }
  return out;
}

/**
 * The one place Sentry gets initialized. Called once from server.ts
 * (before anything else runs, so early startup crashes are still
 * caught) — importing this file alone does NOT init Sentry, since
 * server.ts needs to control exactly when that happens relative to its
 * own process-level handlers.
 *
 * A missing SENTRY_DSN is a normal, fully-supported configuration
 * (self-hosted free-tier users who don't want a third-party error
 * tracker at all) — Sentry.init simply becomes a no-op, and every
 * Sentry.* call elsewhere in this file already no-ops safely too, so
 * nothing else needs an `if (dsn)` check.
 *
 * beforeSend/beforeBreadcrumb run redact() over the ENTIRE outgoing
 * event/breadcrumb — a second, independent layer below createLogger()'s
 * own redaction, so an event that somehow reaches Sentry.* through any
 * path other than this file's own error()/warn() (Sentry's Express
 * integration auto-capturing an unhandled error, for instance) still
 * can't carry a raw Authorization header off this server.
 */
export function initErrorTracking() {
  if (!appConfig.sentry.dsn) return;
  Sentry.init({
    dsn: appConfig.sentry.dsn,
    environment: appConfig.sentry.environment,
    tracesSampleRate: appConfig.sentry.tracesSampleRate,
    beforeSend: (event) => redact(event) as typeof event,
    beforeBreadcrumb: (breadcrumb) => redact(breadcrumb) as typeof breadcrumb,
  });
}

const basePino = pino({
  level: appConfig.logLevel,
  // JSON lines in production (what a log shipper/Sentry breadcrumb
  // wants); pino-pretty's human-readable colorized format everywhere
  // else, since NODE_ENV is unset for a plain `ts-node-dev` run.
  transport:
    appConfig.sentry.environment === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
});

export interface ScopedLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  /**
   * Logs at error level AND forwards to Sentry as a real captured
   * exception (not just a breadcrumb) whenever `err` is an actual
   * Error — pass the caught error as `err` so it shows up in Sentry
   * with its real stack trace, not just this log line's own one.
   */
  error(msg: string, err?: unknown, meta?: Record<string, unknown>): void;
}

/**
 * `createLogger("erpnextConnector")` replaces the old
 * `console.warn(\`[erpnextConnector] ...\`)` convention app-wide — same
 * bracketed-scope idea, but now structured (queryable fields instead of
 * a string prefix) and Sentry-aware for free.
 */
export function createLogger(scope: string): ScopedLogger {
  const child = basePino.child({ scope });
  return {
    info: (msg, meta) => child.info((redact(meta) as object) || {}, msg),
    warn: (msg, meta) => {
      const safeMeta = redact(meta) as Record<string, unknown> | undefined;
      child.warn(safeMeta || {}, msg);
      Sentry.addBreadcrumb({ category: scope, message: msg, level: "warning", data: safeMeta });
    },
    error: (msg, err, meta) => {
      const safeErr = redact(err);
      const safeMeta = redact(meta) as Record<string, unknown> | undefined;
      child.error({ ...(safeMeta || {}), err: safeErr }, msg);
      if (err instanceof Error) {
        // The REAL err (not safeErr) goes to captureException — Sentry
        // needs the actual Error instance for stack-trace fingerprinting
        // and grouping; beforeSend above still redacts whatever Sentry
        // serializes from it before the event actually leaves this
        // process, so this isn't a second unguarded path.
        Sentry.captureException(err, { tags: { scope }, extra: { msg, ...safeMeta } });
      } else {
        Sentry.captureMessage(msg, { level: "error", tags: { scope }, extra: { err: safeErr, ...safeMeta } });
      }
    },
  };
}
