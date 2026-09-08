import { setTimeout as delay } from "node:timers/promises";
import { AccountOperationLock } from "./account-lock.js";
import { withAppServerClient, type AppServerClient } from "./app-server-client.js";
import { CredentialReader } from "./credential-reader.js";
import { object, parseRateLimitResponse, stringAt } from "./rate-limit-parser.js";
import type { CredentialSnapshot, GatewayConfig, RateLimitSnapshot } from "../types.js";
import { GatewayDatabase } from "../db/database.js";

/**
 * How stale a reading may be before a request triggers a fresh read. Auto
 * switching decides on these numbers, so a reading a minute old is already too
 * old to act on: half a minute is the floor everywhere, on every path.
 */
const REFRESH_COOLDOWN_MS = 30_000;
const BACKGROUND_RETRY_DELAY_MS = 2_000;
const REFRESH_CONCURRENCY = 2;

export interface AccountStatusRefresh {
  credential: CredentialSnapshot;
  limits: RateLimitSnapshot;
}

export type ResetCreditOutcome = "reset" | "alreadyRedeemed" | "nothingToReset" | "noCredit";

function safeAuthError(error: unknown): { code: string; relogin: boolean } {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const relogin = /unauthor|\b401\b|relogin|refresh.?token|login.?required|account_relogin_required/.test(message);
  return { code: relogin ? "relogin_required" : "status_check_failed", relogin };
}

function accountMetadata(result: unknown): { mode: string | null; email: string | null; planType: string | null } {
  const account = object(object(result).account);
  if (Object.keys(account).length === 0) throw new Error("account_relogin_required");
  return {
    mode: stringAt(account, "type") ?? "chatgpt",
    email: stringAt(account, "email"),
    planType: stringAt(account, "planType", "plan_type"),
  };
}

export class AccountStatusService {
  private readonly inFlight = new Map<string, { promise: Promise<AccountStatusRefresh>; refreshToken: boolean }>();
  private readonly backgroundTasks = new Set<Promise<boolean>>();
  private readonly lastAttemptAt = new Map<string, number>();
  private readonly reader = new CredentialReader();
  private readonly shutdownController = new AbortController();
  private closed = false;

  /**
   * Called once every attempt settles, whichever path asked for it — the
   * sweep, a request finding the numbers stale, or a 429 — and whether it
   * landed or not. Auto switching decides on these readings, so every one of
   * them is a moment to re-decide; hanging it off the sweep alone made the
   * readings fresh and the decisions five minutes old. A failure is a moment
   * too: that is when an account stops being routable.
   *
   * Taken at construction rather than assigned afterwards, so a second
   * assignment cannot quietly replace it.
   */
  constructor(
    private readonly config: GatewayConfig,
    private readonly database: GatewayDatabase,
    private readonly onSettled: (accountId: string, ok: boolean) => void = () => undefined,
    private readonly lock = new AccountOperationLock(),
  ) {}

  refresh(accountId: string, options: { refreshToken?: boolean; checking?: boolean } = {}): Promise<AccountStatusRefresh> {
    if (this.closed) return Promise.reject(new Error("account_status_service_closed"));
    const current = this.inFlight.get(accountId);
    if (current && (!options.refreshToken || current.refreshToken)) return current.promise;
    // A forced refresh must run after a weaker read, even if that read fails.
    const operation = this.lock.run(accountId, () => this.refreshOnce(accountId, options));
    this.inFlight.set(accountId, { promise: operation, refreshToken: options.refreshToken ?? false });
    void operation.finally(() => {
      if (this.inFlight.get(accountId)?.promise === operation) this.inFlight.delete(accountId);
    }).catch(() => undefined);
    return operation;
  }

  refreshIfStale(accountId: string): void {
    const account = this.database.accounts.get(accountId);
    if (!account || !account.enabled) return;
    const lastAttemptAt = Math.max(this.lastAttemptAt.get(accountId) ?? 0, account.lastLimitsRefreshAt ?? 0);
    if (Date.now() - lastAttemptAt < REFRESH_COOLDOWN_MS) return;
    void this.refreshInBackground(accountId);
  }

  refreshInBackground(accountId: string): Promise<boolean> {
    if (this.closed) return Promise.resolve(false);
    const task = this.refreshWithRetry(accountId).then((ok) => {
      if (!this.closed) this.onSettled(accountId, ok);
      return ok;
    });
    this.backgroundTasks.add(task);
    void task.finally(() => this.backgroundTasks.delete(task));
    return task;
  }

  private async refreshWithRetry(accountId: string): Promise<boolean> {
    return this.refresh(accountId).then(() => true).catch(async () => {
      if (this.closed) return false;
      const account = this.database.accounts.get(accountId);
      if (!account || !account.enabled) return false;
      try {
        await delay(this.retryDelayMs(), undefined, { signal: this.shutdownController.signal });
      } catch {
        return false;
      }
      if (this.closed) return false;
      return this.refresh(accountId).then(() => true).catch(() => false);
    });
  }

  async refreshAll(): Promise<void> {
    if (this.closed) return;
    const ids = this.database.accounts.list().filter((account) => account.enabled).map((account) => account.id);
    let cursor = 0;
    const worker = async () => {
      while (!this.closed && cursor < ids.length) {
        await this.refreshInBackground(ids[cursor++]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(REFRESH_CONCURRENCY, ids.length) }, worker));
  }

  async close(): Promise<void> {
    this.closed = true;
    this.shutdownController.abort();
    await Promise.allSettled(this.backgroundTasks);
    await this.lock.drain();
  }

  consumeResetCredit(accountId: string, idempotencyKey: string, creditId?: string): Promise<ResetCreditOutcome> {
    if (this.closed) return Promise.reject(new Error("account_status_service_closed"));
    return this.lock.run(accountId, async () => {
      const account = this.database.accounts.get(accountId);
      if (!account) throw new Error("account_not_found");
      if (!account.enabled) throw new Error("account_disabled");
      return withAppServerClient(this.config, account.codexHome, async (client) => {
        const result = object(await client.call("account/rateLimitResetCredit/consume", {
          idempotencyKey,
          ...(creditId ? { creditId } : {}),
        }, 30_000));
        const outcome = stringAt(result, "outcome") as ResetCreditOutcome | null;
        if (!outcome || !["reset", "alreadyRedeemed", "nothingToReset", "noCredit"].includes(outcome)) {
          throw new Error("rate_limit_reset_unknown_outcome");
        }
        await this.readAndPersist(accountId, client, false);
        return outcome;
      });
    });
  }

  private async refreshOnce(accountId: string, options: { refreshToken?: boolean; checking?: boolean }): Promise<AccountStatusRefresh> {
    this.lastAttemptAt.set(accountId, Date.now());
    const account = this.database.accounts.get(accountId);
    if (!account) throw new Error("account_not_found");
    if (!account.enabled) throw new Error("account_disabled");
    if (options.checking) this.database.accounts.update(accountId, { authStatus: "checking", authErrorCode: null });
    try {
      return await withAppServerClient(this.config, account.codexHome, (client) =>
        this.readAndPersist(accountId, client, options.refreshToken ?? false));
    } catch (error) {
      const latest = this.database.accounts.get(accountId);
      if (latest) {
        const classified = safeAuthError(error);
        const nextStatus = classified.relogin
          ? "relogin_required"
          : latest.authStatus === "checking" || latest.authStatus === "login_pending"
            ? "error"
            : latest.authStatus;
        this.database.accounts.update(accountId, {
          authStatus: nextStatus,
          authCheckedAt: Date.now(),
          authErrorCode: classified.code,
        });
      }
      throw error;
    }
  }

  private async readAndPersist(accountId: string, client: AppServerClient, refreshToken: boolean): Promise<AccountStatusRefresh> {
    const official = accountMetadata(await client.call("account/read", { refreshToken }, 60_000));
    const limits = parseRateLimitResponse(await client.call("account/rateLimits/read", {}, 30_000));
    const credential = await this.reader.read(this.database.accounts.get(accountId)!.codexHome);
    if (credential.fedRamp) {
      this.database.accounts.update(accountId, {
        fedRamp: true,
        enabled: false,
        authStatus: "unsupported_fedramp",
        authCheckedAt: Date.now(),
        authErrorCode: "unsupported_fedramp",
      });
      throw new Error("fedramp_accounts_not_supported");
    }
    const now = Date.now();
    this.database.accounts.updateRateLimits(accountId, limits);
    this.database.accounts.update(accountId, {
      chatgptAccountId: credential.accountId,
      email: official.email ?? credential.email,
      planType: official.planType ?? limits.planType ?? credential.planType,
      authMode: official.mode,
      authStatus: !this.database.accounts.get(accountId)?.enabled ? "disabled" : limits.rateLimitReachedType ? "rate_limited" : "ready",
      authCheckedAt: now,
      authLastSuccessfulAt: now,
      authErrorCode: null,
    });
    return { credential, limits };
  }

  private retryDelayMs(): number {
    return BACKGROUND_RETRY_DELAY_MS * (0.8 + Math.random() * 0.4);
  }
}
