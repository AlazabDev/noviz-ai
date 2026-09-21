import pino from "pino";
import * as Sentry from "@sentry/node";
import { appConfig } from "../config/app.config";

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
 */
export function initErrorTracking() {
  if (!appConfig.sentry.dsn) return;
  Sentry.init({
    dsn: appConfig.sentry.dsn,
    environment: appConfig.sentry.environment,
    tracesSampleRate: appConfig.sentry.tracesSampleRate,
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
    info: (msg, meta) => child.info(meta || {}, msg),
    warn: (msg, meta) => {
      child.warn(meta || {}, msg);
      Sentry.addBreadcrumb({ category: scope, message: msg, level: "warning", data: meta });
    },
    error: (msg, err, meta) => {
      child.error({ ...(meta || {}), err }, msg);
      if (err instanceof Error) {
        Sentry.captureException(err, { tags: { scope }, extra: { msg, ...meta } });
      } else {
        Sentry.captureMessage(msg, { level: "error", tags: { scope }, extra: { err, ...meta } });
      }
    },
  };
}
