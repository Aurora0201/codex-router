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
    const subscriptionStartedAt = body.subscriptionStartedAt;
    const hasEnabled = typeof enabled === "boolean";
    const hasSubscriptionDate = subscriptionStartedAt === null
      || (typeof subscriptionStartedAt === "number"
        && Number.isSafeInteger(subscriptionStartedAt)
        && subscriptionStartedAt >= 0);
    if (!hasEnabled && !hasSubscriptionDate) {
      await reply.code(400).send({ error: "invalid_account_patch" });
      return;
    }
    await apiAction(reply, () => {
      if (hasEnabled) ctx.accounts.setEnabled(request.params.id, enabled);
      if (hasSubscriptionDate) {
        ctx.database.accounts.update(request.params.id, { subscriptionStartedAt });
      }
      const result = toAccountView(ctx.accounts.get(request.params.id), ctx.database.getActiveAccountId());
      ctx.events.invalidate("accounts", "stats");
      return result;
    });
  });

  app.delete<{ Params: { id: string } }>("/api/accounts/:id", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, async () => {
      await ctx.accounts.remove(request.params.id);
      ctx.events.invalidate("accounts", "stats");
    });
  });

  app.post<{ Params: { id: string } }>("/api/accounts/:id/refresh-auth", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, async () => {
      await ctx.auth.refresh(request.params.id);
      ctx.events.invalidate("accounts", "stats");
      return toAccountView(ctx.accounts.get(request.params.id), ctx.database.getActiveAccountId());
    });
  });

  app.post<{ Params: { id: string } }>("/api/accounts/:id/refresh-limits", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, async () => {
      await ctx.usage.refresh(request.params.id);
      ctx.events.invalidate("accounts");
      return toAccountView(ctx.accounts.get(request.params.id), ctx.database.getActiveAccountId());
    });
  });
}
