import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";
import { GATEWAY_VERSION } from "../../version.js";

export function registerHealthRoutes(app: FastifyInstance, ctx: AdminContext): void {
  app.get("/api/health", async (_request, reply) => ({
    status: "ok",
    upstream: "configured",
    accounts: ctx.database.accounts.list().length,
    csrfToken: ctx.csrf.issue(reply),
    version: GATEWAY_VERSION,
    uptime: Math.max(0, Math.floor((Date.now() - ctx.startedAt) / 1000)),
    pid: process.pid,
    dataDir: ctx.config.dataDir,
    databasePath: ctx.config.databasePath,
    logFilePath: ctx.config.logFilePath,
  }));
}
