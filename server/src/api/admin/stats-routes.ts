import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";

export function registerStatsRoutes(app: FastifyInstance, ctx: AdminContext): void {
  app.get("/api/stats", async () => {
    const today = ctx.database.requestLog.todayCounts();
    return {
      uptimeSeconds: Math.floor((Date.now() - ctx.startedAt) / 1000),
      requestsToday: today.requests,
      errorsToday: today.errors,
      accountsReady: ctx.database.accounts.list().filter((account) => account.enabled && account.authStatus === "ready").length,
    };
  });
}
