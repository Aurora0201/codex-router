import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AdminContext } from "../admin/context.js";
import { hasBrowserOrigin } from "../../security/origin-guard.js";
import { GATEWAY_VERSION } from "../../version.js";
import { nextBillingAt } from "./billing-cycle.js";

/** Bump when a field changes meaning or leaves. Additions do not bump it. */
const CONTRACT_VERSION = 1;

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * Two guards, and neither asks the caller for a credential.
 *
 * The address check is the promise in the name: only this machine. The gateway
 * already binds loopback, so this is defence in depth rather than the only
 * lock.
 *
 * The origin check is the one that matters in practice. Without it any page in
 * any browser could fetch this endpoint and read the account emails, because
 * a page is free to call 127.0.0.1. A native local program sends no Origin or
 * Referer, so requiring their absence separates local tooling from web pages
 * without a token for the caller to obtain and store.
 */
function isLocalCaller(request: FastifyRequest): boolean {
  if (hasBrowserOrigin(request)) return false;
  const address = request.socket.remoteAddress;
  return typeof address === "string" && LOOPBACK.has(address);
}

function quotaWindow(
  usedPercent: number | null,
  resetsAt: number | null,
  windowDurationMins: number | null,
) {
  if (windowDurationMins === null) return null;
  return {
    windowDurationMins,
    usedPercent,
    // The console shows what is left, and reading this backwards is the
    // easiest mistake to make against this payload, so both are stated.
    remainingPercent: usedPercent === null ? null : Math.max(0, 100 - usedPercent),
    resetsAt,
  };
}

export function registerLocalStatusRoutes(app: FastifyInstance, ctx: AdminContext): void {
  app.get("/api/local/v1/status", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isLocalCaller(request)) return reply.code(403).send({ error: "not_a_local_caller" });

    const now = Date.now();
    const today = ctx.database.requestLog.todayCounts();
    const activeAccountId = ctx.activeAccounts.get()?.id ?? null;

    return {
      contractVersion: CONTRACT_VERSION,
      generatedAt: now,
      gateway: {
        version: GATEWAY_VERSION,
        uptimeSeconds: Math.floor((now - ctx.startedAt) / 1000),
      },
      today: { requests: today.requests, errors: today.errors },
      activeAccountId,
      accounts: ctx.database.accounts.list().map((account) => ({
        id: account.id,
        chatgptAccountId: account.chatgptAccountId,
        email: account.email,
        planType: account.planType,
        enabled: account.enabled,
        isActive: account.id === activeAccountId,
        auth: {
          status: account.authStatus,
          lastSuccessfulAt: account.authLastSuccessfulAt,
        },
        quota: {
          // Named by role rather than by duration: which window is the 7-day
          // one is upstream's decision and has changed before.
          primary: quotaWindow(account.primaryUsedPercent, account.primaryResetsAt, account.primaryWindowMinutes),
          secondary: quotaWindow(account.secondaryUsedPercent, account.secondaryResetsAt, account.secondaryWindowMinutes),
          refreshedAt: account.lastLimitsRefreshAt,
        },
        billing: {
          anchorAt: account.billingAnchorAt,
          cadence: account.billingCadence,
          nextRenewalAt: nextBillingAt(account.billingAnchorAt, account.billingCadence, now),
        },
      })),
    };
  });
}
