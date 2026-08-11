import type { FastifyInstance } from "fastify";
import type { AdminContext } from "./context.js";
import { toAccountView } from "./context.js";
import { apiAction, csrfProtect, jsonBody } from "./helpers.js";

export function registerActiveAccountRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const protect = csrfProtect(ctx.csrf);

  app.get("/api/active-account", async () => {
    const account = ctx.activeAccounts.get();
    return account ? toAccountView(account, account.id) : null;
  });

  app.put("/api/active-account", { preHandler: protect }, async (request, reply) => {
    const body = jsonBody(request);
    const id = body.id;
    if (typeof id !== "string" || !id) {
      await reply.code(400).send({ error: "invalid_active_account" });
      return;
    }
    await apiAction(reply, () => {
      const result = toAccountView(ctx.activeAccounts.select(id), id);
      ctx.events.invalidate("accounts");
      return result;
    });
  });

  app.delete("/api/active-account", { preHandler: protect }, async (_request, reply) => {
    await apiAction(reply, () => {
      ctx.activeAccounts.clear();
      ctx.events.invalidate("accounts");
    });
  });
}
