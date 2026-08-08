import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";
import { apiAction, csrfProtect } from "./helpers.js";

export function registerAccountLoginRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const protect = csrfProtect(ctx.csrf);

  app.post("/api/account-logins", { preHandler: protect }, async (_request, reply) => {
    await apiAction(reply, () => ctx.logins.start());
  });

  app.get<{ Params: { loginId: string } }>("/api/account-logins/:loginId", async (request, reply) => {
    await apiAction(reply, () => ctx.logins.getStatus(request.params.loginId));
  });

  app.delete<{ Params: { loginId: string } }>("/api/account-logins/:loginId", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => ctx.logins.cancel(request.params.loginId));
  });
}
