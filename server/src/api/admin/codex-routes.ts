import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";
import { apiAction, csrfProtect } from "./helpers.js";
import { CodexConfigService } from "../../codex/codex-config.js";
import { restartCodex } from "../../codex/codex-process.js";

export function registerCodexRoutes(app: FastifyInstance, ctx: AdminContext, codexConfig: CodexConfigService): void {
  const protect = csrfProtect(ctx.csrf);

  app.get("/api/codex/status", async () => {
    const config = await codexConfig.status(ctx.config.host, ctx.config.port);
    const running = ctx.codexProcess.isRunning();
    return { ...config, codexRunning: running };
  });

  app.post("/api/codex/apply-config", { preHandler: protect }, async (_request, reply) => {
    await apiAction(reply, async () => {
      const result = await codexConfig.applyGatewayConfig(ctx.config.host, ctx.config.port);
      ctx.events.invalidate("codex");
      return result;
    });
  });

  app.post("/api/codex/restore-config", { preHandler: protect }, async (_request, reply) => {
    await apiAction(reply, async () => {
      const result = await codexConfig.restoreGatewayConfig(ctx.config.host, ctx.config.port);
      ctx.events.invalidate("codex");
      return result;
    });
  });

  app.post("/api/codex/restart", { preHandler: protect }, async (_request, reply) => {
    await apiAction(reply, async () => {
      const result = await restartCodex();
      await ctx.codexProcess.refresh();
      ctx.events.invalidate("codex");
      return result;
    });
  });
}
