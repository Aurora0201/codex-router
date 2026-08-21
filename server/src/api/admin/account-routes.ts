import type { FastifyInstance } from "fastify";
import type { AdminContext, AccountView } from "./context.js";
import { toAccountView } from "./context.js";
import { apiAction, csrfProtect, jsonBody } from "./helpers.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function registerAccountRoutes(app: FastifyInstance, ctx: AdminContext): void {
  const protect = csrfProtect(ctx.csrf);

  app.get("/api/accounts", async () => {
    const activeAccountId = ctx.database.getActiveAccountId();
    const accounts: AccountView[] = ctx.accounts.list().map((account) => toAccountView(account, activeAccountId));
    return { activeAccountId, accounts };
  });

  app.post("/api/accounts/refresh-status", { preHandler: protect }, async (_request, reply) => {
    void ctx.accountStatus.refreshAll(() => ctx.events.invalidate("accounts")).catch(() => undefined);
    await reply.code(202).send({ started: true });
  });

  app.patch<{ Params: { id: string } }>("/api/accounts/:id", { preHandler: protect }, async (request, reply) => {
    const body = jsonBody(request);
    const enabled = body.enabled;
    const subscriptionExpiresAt = body.subscriptionExpiresAt;
    const hasEnabled = typeof enabled === "boolean";
    const hasSubscriptionExpiry = Object.hasOwn(body, "subscriptionExpiresAt");
    const validSubscriptionExpiry = !hasSubscriptionExpiry || subscriptionExpiresAt === null
      || (typeof subscriptionExpiresAt === "number" && Number.isSafeInteger(subscriptionExpiresAt) && subscriptionExpiresAt >= 0);
    if ((!hasEnabled && !hasSubscriptionExpiry) || !validSubscriptionExpiry) {
      await reply.code(400).send({ error: "invalid_account_patch" });
      return;
    }
    await apiAction(reply, () => {
      if (hasEnabled) {
        ctx.accounts.setEnabled(request.params.id, enabled);
        if (enabled) {
          void ctx.accountStatus.refresh(request.params.id, { checking: true })
            .finally(() => ctx.events.invalidate("accounts", "stats"))
            .catch(() => undefined);
        }
      }
      if (hasSubscriptionExpiry) {
        ctx.database.accounts.update(request.params.id, {
          subscriptionExpiresAt: subscriptionExpiresAt as number | null,
          subscriptionExpirySource: subscriptionExpiresAt === null ? null : "manual",
        });
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
      await ctx.accountStatus.refresh(request.params.id, { refreshToken: true, checking: true });
      ctx.events.invalidate("accounts", "stats");
      return toAccountView(ctx.accounts.get(request.params.id), ctx.database.getActiveAccountId());
    });
  });

  app.post<{ Params: { id: string } }>("/api/accounts/:id/refresh-limits", { preHandler: protect }, async (request, reply) => {
    await apiAction(reply, async () => {
      await ctx.accountStatus.refresh(request.params.id);
      ctx.events.invalidate("accounts");
      return toAccountView(ctx.accounts.get(request.params.id), ctx.database.getActiveAccountId());
    });
  });

  app.post<{ Params: { id: string } }>("/api/accounts/:id/rate-limit-reset-credits/consume", { preHandler: protect }, async (request, reply) => {
    const body = jsonBody(request);
    const idempotencyKey = body.idempotencyKey;
    const creditId = body.creditId;
    if (typeof idempotencyKey !== "string" || !UUID_PATTERN.test(idempotencyKey)
      || (creditId !== undefined && (typeof creditId !== "string" || !creditId || creditId.length > 512))) {
      await reply.code(400).send({ error: "invalid_rate_limit_reset_request" });
      return;
    }
    await apiAction(reply, async () => {
      const outcome = await ctx.accountStatus.consumeResetCredit(
        request.params.id,
        idempotencyKey,
        typeof creditId === "string" ? creditId : undefined,
      );
      ctx.events.invalidate("accounts");
      return {
        outcome,
        account: toAccountView(ctx.accounts.get(request.params.id), ctx.database.getActiveAccountId()),
      };
    });
  });
}
