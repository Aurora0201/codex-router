import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";

export function registerHealthRoutes(app: FastifyInstance, ctx: AdminContext): void {
  app.get("/api/health", async (_request, reply) => ({
    status: "ok",
    upstream: "configured",
    accounts: ctx.database.accounts.list().length,
    csrfToken: ctx.csrf.issue(reply),
    version: "0.2.0",
    uptime: Math.max(0, Math.floor((Date.now() - ctx.startedAt) / 1000)),
  }));
}
