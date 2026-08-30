import type { FastifyInstance } from "fastify";
import type { AdminContext, AccountView } from "./context.js";
import { toAccountView } from "./context.js";
import { apiAction, csrfProtect, jsonBody } from "./helpers.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60_000;

export function validBillingPatch(body: Record<string, unknown>, now = Date.now()): boolean {
  const billingAnchorAt = body.billingAnchorAt;
  const billingCadence = body.billingCadence;
  const hasBillingAnchor = Object.hasOwn(body, "billingAnchorAt");
  const hasBillingCadence = Object.hasOwn(body, "billingCadence");
  if (hasBillingAnchor !== hasBillingCadence) return false;
  if (!hasBillingAnchor) return true;
  if (billingAnchorAt === null && billingCadence === null) return true;
  const date = new Date(now);
  const todayUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return typeof billingAnchorAt === "number"
    && Number.isSafeInteger(billingAnchorAt)
    && billingAnchorAt >= 0
    && billingAnchorAt % DAY_MS === 0
    && billingAnchorAt <= todayUtc
    && (billingCadence === "monthly" || billingCadence === "annual");
}

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
    const billingAnchorAt = body.billingAnchorAt;
    const billingCadence = body.billingCadence;
    const hasEnabled = typeof enabled === "boolean";
    const hasBillingAnchor = Object.hasOwn(body, "billingAnchorAt");
    if ((!hasEnabled && !hasBillingAnchor) || !validBillingPatch(body)) {
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
      if (hasBillingAnchor) {
        ctx.database.accounts.update(request.params.id, {
          billingAnchorAt: billingAnchorAt as number | null,
          billingCadence: billingCadence as "monthly" | "annual" | null,
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
