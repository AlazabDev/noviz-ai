import { LLMProvider, LLMMessage, LLMResponse, ToolDefinition } from "../../core/types";
import { appConfig } from "../../config/app.config";
import { createLogger } from "../../core/logger";
import axios from "axios";
import http from "http";
import https from "https";

const logger = createLogger("azureFoundryProvider");

// Same connection-reuse reasoning as openaiProvider.ts — a multi-tool-call
// turn makes 2+ sequential calls to the same Foundry resource host.
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });
const llmHttp = axios.create({ httpAgent, httpsAgent });

/**
 * Azure AI Foundry Agent Service implementation of LLMProvider, talking
 * to the Responses API directly over REST (axios) rather than through
 * @azure/ai-projects — three real reasons:
 *
 *  1. This engine needs FULL control over the tool list and full
 *     message-history replay on every single call (see the `messages`
 *     mapping below) — exactly what openaiProvider.ts already does for
 *     chat-completions. The Responses API supports that same
 *     "stateless, full-history-in-input" shape just as well as its own
 *     conversation/previous_response_id shape, so there's no reason to
 *     take on a second state model (and the orphaned
 *     function_call_output bugs that come with chaining
 *     previous_response_id across turns) just to use it.
 *  2. As of late 2026 the PROJECT-scoped route
 *     (".../api/projects/<name>/openai/v1/responses") has a confirmed
 *     HTTP 431 bug on some Foundry resources (header-size rejection,
 *     independent of auth method). The RESOURCE-level route
 *     (".../openai/v1/responses") does not have this problem, so that's
 *     the one this file calls — derived automatically from the project
 *     endpoint you already have (see resourceResponsesUrl below).
 *  3. Keeps this integration exactly as inspectable/debuggable as
 *     openaiProvider.ts (one plain HTTP call you can literally curl to
 *     reproduce) instead of an extra SDK layer.
 *
 * Talks to a pre-built Foundry Agent (by name/version — configured
 * separately in the Foundry portal, with whatever instructions/grounding
 * you gave it there) via the `agent_reference` request field, while
 * STILL passing this turn's own dynamic tool list on every call — Foundry
 * agents support this ("agent.run(query, tools=[...])" per-call tool
 * sets — see Microsoft's function-calling docs) — so tool availability
 * still follows this app's own role-based gateway.ts filtering exactly
 * like it does for OpenAI, not whatever's fixed on the agent itself.
 */
export class AzureFoundryProvider implements LLMProvider {
  async chat(messages: LLMMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const cfg = appConfig.azureFoundry;
    if (!cfg.endpoint) {
      throw new Error("Azure Foundry is not configured (AZURE_FOUNDRY_ENDPOINT missing).");
    }

    const toolSchemas = tools.map((t) => ({
      // Responses API tool schema is FLAT (name/description/parameters
      // directly on the tool object) — unlike chat-completions' nested
      // {type:"function", function:{name,...}} shape in openaiProvider.ts.
      type: "function",
      name: toResponsesName(t.name),
      description: t.description,
      parameters: t.parameters || { type: "object", properties: {} },
    }));

    const input = messagesToResponsesInput(messages);

    const body: Record<string, any> = {
      input,
      // Sent under both keys on purpose: Microsoft's current docs show
      // the raw field as "agent_reference", but the working reference
      // snippet this integration was built from used "agent" (same
      // shape) — cheap redundancy against a naming difference between
      // API/SDK versions; an API version that only recognizes one of the
      // two simply ignores the other.
      agent: { name: cfg.agentName, version: cfg.agentVersion || undefined, type: "agent_reference" },
      agent_reference: { name: cfg.agentName, version: cfg.agentVersion || undefined, type: "agent_reference" },
    };
    if (toolSchemas.length) {
      body.tools = toolSchemas;
      // Same "force genuinely serial tool calls" reasoning as
      // openaiProvider.ts.
      body.parallel_tool_calls = false;
    }

    const url = resourceResponsesUrl(cfg.endpoint);
    const headers = await buildAuthHeaders();

    // Same retry shape as openaiProvider.ts (429 backoff honoring the
    // provider's own "retry in Ns" message, timeout retry, capped
    // attempts) — kept as a near-identical copy rather than a shared
    // helper so each provider file stays a single, complete,
    // independently-readable account of its own wire format.
    const MAX_ATTEMPTS = 6;
    const REQUEST_TIMEOUT_MS = 25_000;
    let lastErr: any;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const res = await llmHttp.post(url, body, { headers, timeout: REQUEST_TIMEOUT_MS });
        return parseResponsesOutput(res.data);
      } catch (err: any) {
        lastErr = err;
        const status = err.response?.status;
        const isTimeout = err.code === "ECONNABORTED" || /timeout/i.test(err.message || "");
        const message = err.response?.data?.error?.message || err.message;
        if (status === 429 && attempt < MAX_ATTEMPTS - 1) {
          const waitMs = Math.min(parseRetryAfterMs(message) ?? 1500, 10000) + Math.floor(Math.random() * 300);
          logger.warn(`429 rate limited (attempt ${attempt + 1}), retrying in ${waitMs}ms`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        if (attempt < MAX_ATTEMPTS - 1 && isTimeout) {
          const waitMs = 300 + Math.floor(Math.random() * 300);
          logger.warn(`request timed out after ${REQUEST_TIMEOUT_MS}ms (attempt ${attempt + 1}), retrying in ${waitMs}ms`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }
        const wrapped = new Error(isTimeout ? `Azure Foundry request timed out after ${REQUEST_TIMEOUT_MS}ms` : `Azure Foundry request failed: ${message}`);
        (wrapped as any).status = status;
        throw wrapped;
      }
    }
    throw lastErr;
  }
}

/**
 * Given the PROJECT endpoint you copy from the Foundry portal
 * ("https://<resource>.services.ai.azure.com/api/projects/<project>"),
 * returns the RESOURCE-level Responses API URL
 * ("https://<resource>.services.ai.azure.com/openai/v1/responses") —
 * see this file's own top doc comment for why the resource-level route
 * is the one actually called. Endpoints that don't contain
 * "/api/projects/" are assumed to already be resource-level and are
 * used as-is (with "/openai/v1/responses" appended if missing).
 */
export function resourceResponsesUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, "");
  const projectMarker = "/api/projects/";
  const idx = trimmed.indexOf(projectMarker);
  const resourceRoot = idx >= 0 ? trimmed.slice(0, idx) : trimmed;
  return `${resourceRoot}/openai/v1/responses`;
}

// ---- Auth: API key (default) or Entra ID client-credentials (fallback) ----

let cachedToken: { value: string; expiresAt: number } | null = null;

async function buildAuthHeaders(): Promise<Record<string, string>> {
  const cfg = appConfig.azureFoundry;
  if (cfg.apiKey) {
    // Simplest path — a Foundry resource key, same header REST/curl
    // examples in Microsoft's own docs use.
    return { "api-key": cfg.apiKey, "Content-Type": "application/json" };
  }
  if (cfg.tenantId && cfg.clientId && cfg.clientSecret) {
    const token = await getEntraToken(cfg.tenantId, cfg.clientId, cfg.clientSecret);
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }
  throw new Error(
    "Azure Foundry auth is not configured — set AZURE_FOUNDRY_API_KEY, or all three of AZURE_FOUNDRY_TENANT_ID/AZURE_FOUNDRY_CLIENT_ID/AZURE_FOUNDRY_CLIENT_SECRET."
  );
}

/**
 * Plain REST equivalent of what `DefaultAzureCredential` does under the
 * hood for a service-principal (client-credentials grant) — no
 * @azure/identity dependency, same reasoning as the rest of this file.
 * Caches the token and only re-fetches once it's within 60s of expiry.
 */
async function getEntraToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) {
    return cachedToken.value;
  }
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    // The fixed resource scope every Foundry/Azure AI resource accepts,
    // regardless of which specific resource/project you're calling.
    scope: "https://ai.azure.com/.default",
  });
  const res = await llmHttp.post(tokenUrl, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15_000,
  });
  cachedToken = { value: res.data.access_token, expiresAt: Date.now() + res.data.expires_in * 1000 };
  return cachedToken.value;
}

// ---- Message <-> Responses API "input" item translation ----

/**
 * Our provider-agnostic LLMMessage[] (see types.ts) into the Responses
 * API's `input` item array. Three shapes, mirroring exactly the three
 * cases openaiProvider.ts's own `messages.map(...)` handles for
 * chat-completions:
 *   - a plain system/user/assistant text turn -> one {role, content} item
 *   - an assistant turn that made tool calls -> the text part (if any)
 *     PLUS one {type:"function_call", ...} item per call
 *   - a tool-result turn -> one {type:"function_call_output", ...} item
 */
function messagesToResponsesInput(messages: LLMMessage[]): any[] {
  const input: any[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls?.length) {
      if (m.content) {
        input.push({ role: "assistant", content: m.content });
      }
      for (const tc of m.tool_calls) {
        input.push({
          type: "function_call",
          call_id: tc.id,
          name: toResponsesName(tc.name),
          arguments: JSON.stringify(tc.arguments),
        });
      }
      continue;
    }
    if (m.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: m.tool_call_id,
        output: m.content,
      });
      continue;
    }
    input.push({ role: m.role, content: m.content });
  }
  return input;
}

/**
 * The raw REST response has no `output_text` convenience getter (that's
 * an official-SDK-only affordance) — this walks `output` itself:
 * "message" items' `content` parts (type "output_text") are joined for
 * the text answer; "function_call" items become our LLMToolCall[].
 */
function parseResponsesOutput(data: any): LLMResponse {
  let content: string | null = null;
  const tool_calls: { id: string; name: string; arguments: any }[] = [];

  for (const item of data.output || []) {
    if (item.type === "message") {
      const text = (item.content || [])
        .filter((part: any) => part.type === "output_text" && typeof part.text === "string")
        .map((part: any) => part.text)
        .join("");
      if (text) content = (content || "") + text;
    } else if (item.type === "function_call") {
      tool_calls.push({ id: item.call_id, name: fromResponsesName(item.name), arguments: safeParse(item.arguments) });
    }
  }

  const rawUsage = data.usage;
  const usage = rawUsage
    ? {
        promptTokens: rawUsage.input_tokens ?? 0,
        completionTokens: rawUsage.output_tokens ?? 0,
        totalTokens: rawUsage.total_tokens ?? 0,
      }
    : undefined;

  return { content, tool_calls, usage };
}

/** Pulls the wait time out of a "Please try again in 2.641s" / "...in
 *  500ms" 429 message — same helper as openaiProvider.ts's own (kept as
 *  a local copy so this file has no import dependency on that one). */
export function parseRetryAfterMs(message: string): number | null {
  const ms = message?.match(/try again in ([\d.]+)ms/i);
  if (ms) return Math.ceil(parseFloat(ms[1]));
  const sec = message?.match(/try again in ([\d.]+)s/i);
  if (sec) return Math.ceil(parseFloat(sec[1]) * 1000);
  return null;
}

// Same dot-namespaced-tool-name problem/fix as openaiProvider.ts's own
// toOpenAIName/fromOpenAIName — the Responses API's function tool names
// follow the same ^[a-zA-Z0-9_-]+$ constraint.
function toResponsesName(name: string) {
  return name.replace(/\./g, "__");
}

function fromResponsesName(name: string) {
  return name.replace(/__/g, ".");
}

function safeParse(json: string) {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}
