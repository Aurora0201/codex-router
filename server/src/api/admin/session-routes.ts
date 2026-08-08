import type { FastifyInstance } from "fastify";
import type { SessionRecord } from "../../types.js";
import type { AdminContext } from "./context.js";
import { apiAction, csrfProtect } from "./helpers.js";

export function registerSessionRoutes(app: FastifyInstance, ctx: AdminContext, activity: { count(key: string): number }): void {
  const protect = csrfProtect(ctx.csrf);

  app.get("/api/sessions", async () => {
    return ctx.database.sessions.list().map((session): SessionRecord => ({
      ...session,
      activeRequests: activity.count(session.routingKey),
    }));
  });

  app.post<{ Params: { id: string } }>("/api/sessions/:id/release", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => {
      if (activity.count(request.params.id) > 0) throw new Error("session_is_active");
      ctx.database.sessions.release(request.params.id);
    });
  });
}
