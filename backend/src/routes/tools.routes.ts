import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth/middleware";
import { callTool, listAllowedTools } from "../core/gateway";
import { createLogger } from "../core/logger";

const logger = createLogger("tools.routes");

/**
 * GENERIC structured API surface — replaces per-module route files.
 * Any tool any module registers is automatically reachable here, so
 * the frontend's table/report views can call a known tool directly
 * without a new backend route being written for every module.
 */
const router = Router();
router.use(requireAuth);

router.get("/", (req: AuthedRequest, res) => {
  const tools = listAllowedTools(req.session!);
  res.json({ tools: tools.map((t) => ({ name: t.name, description: t.description, module: t.module })) });
});

router.post("/:toolName", async (req: AuthedRequest, res) => {
  try {
    const data = await callTool(req.session!, req.params.toolName, req.body || {});
    res.json({ data });
  } catch (err: any) {
    // Confirmed live 2026-08-17: this route's own catch swallowed a real
    // ERPNext validation error entirely — no console.error at all, unlike
    // reasoningEngine.ts's tool-call failure logging (which explicitly
    // captures the upstream status/body), so the ONLY signal reaching the
    // caller was axios's generic "Request failed with status code 500",
    // and nothing at all reached the server logs to diagnose from. This
    // route is a direct, LLM-bypassing entry point (used by the frontend's
    // table/report views AND for testing), so its own errors deserve the
    // same visibility as every tool call the reasoning loop makes.
    const status = err.name === "ToolNotAllowedError" ? 403 : err.status || err.response?.status || 400;
    logger.error(`${req.params.toolName} failed`, err, {
      upstreamStatus: err.response?.status,
      upstreamBody: err.response?.data ? JSON.stringify(err.response.data).slice(0, 500) : undefined,
    });
    res.status(status).json({ error: err.response?.data?.exception || err.response?.data?.message || err.message });
  }
});

export default router;
