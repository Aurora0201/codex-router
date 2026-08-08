import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";
import { apiAction, csrfProtect } from "./helpers.js";
import { CodexConfigService } from "../../codex/codex-config.js";
import { codexRunning, restartCodex } from "../../codex/codex-process.js";

export function registerCodexRoutes(app: FastifyInstance, ctx: AdminContext, codexConfig: CodexConfigService): void {
  const protect = csrfProtect(ctx.csrf);

  app.get("/api/codex/status", async () => {
    const [config, running] = await Promise.all([
      codexConfig.status(ctx.config.host, ctx.config.port),
      codexRunning(),
    ]);
    return { ...config, codexRunning: running };
  });

  app.post("/api/codex/apply-config", { preHandler: protect }, async (_request, reply) => {
    await apiAction(reply, () => codexConfig.applyGatewayConfig(ctx.config.host, ctx.config.port));
  });

  app.post("/api/codex/restore-config", { preHandler: protect }, async (_request, reply) => {
    await apiAction(reply, () => codexConfig.restoreGatewayConfig(ctx.config.host, ctx.config.port));
  });

  app.post("/api/codex/restart", { preHandler: protect }, async (_request, reply) => {
    await apiAction(reply, () => restartCodex());
  });
}
