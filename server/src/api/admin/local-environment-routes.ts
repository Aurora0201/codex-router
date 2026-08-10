import path from "node:path";
import type { FastifyInstance } from "fastify";
import open from "open";
import type { CodexConfigService } from "../../codex/codex-config.js";
import type { AdminContext } from "./context.js";
import { apiAction, csrfProtect, jsonBody } from "./helpers.js";

const TARGETS = new Set(["data", "backup", "logs"]);

export function registerLocalEnvironmentRoutes(
  app: FastifyInstance,
  ctx: AdminContext,
  codexConfig: CodexConfigService,
): void {
  app.post("/api/local-environment/open", { preHandler: csrfProtect(ctx.csrf) }, async (request, reply) => {
    await apiAction(reply, async () => {
      const target = jsonBody(request).target;
      if (typeof target !== "string" || !TARGETS.has(target)) throw new Error("invalid_local_environment_target");

      let directory: string;
      if (target === "data") directory = ctx.config.dataDir;
      else if (target === "backup") directory = path.dirname((await codexConfig.status(ctx.config.host, ctx.config.port)).backupPath);
      else {
        if (!ctx.config.logFilePath) throw new Error("local_environment_target_not_found");
        directory = path.dirname(ctx.config.logFilePath);
      }

      await open(directory, { wait: false });
    });
  });
}
