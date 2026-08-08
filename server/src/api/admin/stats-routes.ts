import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";

export function registerStatsRoutes(app: FastifyInstance, ctx: AdminContext, activity: { count(key: string): number }): void {
  app.get("/api/stats", async () => {
    const today = ctx.database.requestLog.todayCounts();
    const sessions = ctx.database.sessions.list();
    const activeSessions = sessions.filter((session) => session.status === "active").length;
    return {
      uptimeSeconds: Math.floor((Date.now() - ctx.startedAt) / 1000),
      activeSessions,
      activeWebSockets: sessions.filter((session) => session.transport === "ws" && activity.count(session.routingKey) > 0).length,
      requestsToday: today.requests,
      errorsToday: today.errors,
      accountsReady: ctx.database.accounts.list().filter((account) => account.enabled && account.authStatus === "ready").length,
    };
  });
}
