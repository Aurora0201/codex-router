import type { FastifyInstance } from "fastify";
import type { AdminContext, AccountView } from "./context.js";
import { toAccountView } from "./context.js";
import { apiAction, csrfProtect, jsonBody } from "./helpers.js";

export function registerAccountRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const protect = csrfProtect(ctx.csrf);

  app.get("/api/accounts", async () => {
    const activeAccountId = ctx.database.getActiveAccountId();
    const accounts: AccountView[] = ctx.accounts.list().map((account) => toAccountView(account, activeAccountId));
    return { activeAccountId, accounts };
  });

  app.patch<{ Params: { id: string } }>("/api/accounts/:id", { preHandler: protect }, async (request, reply) => {
    const body = jsonBody(request);
    const enabled = body.enabled;
    if (typeof enabled !== "boolean") {
      await reply.code(400).send({ error: "invalid_account_patch" });
      return;
    }
    await apiAction(reply, () => toAccountView(ctx.accounts.setEnabled(request.params.id, enabled), ctx.database.getActiveAccountId()));
  });

  app.delete<{ Params: { id: string } }>("/api/accounts/:id", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, () => ctx.accounts.remove(request.params.id));
  });

  app.post<{ Params: { id: string } }>("/api/accounts/:id/refresh-auth", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, async () => {
      await ctx.auth.refresh(request.params.id);
      return toAccountView(ctx.accounts.get(request.params.id), ctx.database.getActiveAccountId());
    });
  });

  app.post<{ Params: { id: string } }>("/api/accounts/:id/refresh-limits", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, async () => {
      await ctx.usage.refresh(request.params.id);
      return toAccountView(ctx.accounts.get(request.params.id), ctx.database.getActiveAccountId());
    });
  });
}
