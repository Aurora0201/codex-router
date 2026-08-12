import type { GatewayConfig, RateLimitSnapshot } from "../types.js";
import { GatewayDatabase } from "../db/database.js";
import { withAppServerClient } from "./app-server-client.js";
import { parseRateLimitResponse } from "./rate-limit-parser.js";

const REFRESH_COOLDOWN_MS = 60_000;
const BACKGROUND_RETRY_DELAY_MS = 2_000;

export class AccountUsageService {
  private readonly inFlight = new Map<string, Promise<RateLimitSnapshot>>();
  private readonly lastAttemptAt = new Map<string, number>();

  constructor(
    private readonly config: GatewayConfig,
    private readonly database: GatewayDatabase,
  ) {}

  refresh(accountId: string): Promise<RateLimitSnapshot> {
    return this.singleFlight(accountId, () => this.refreshOnce(accountId));
  }

  refreshIfStale(accountId: string): void {
    const account = this.database.accounts.get(accountId);
    if (!account || !account.enabled) return;
    const lastAttemptAt = Math.max(this.lastAttemptAt.get(accountId) ?? 0, account.lastLimitsRefreshAt ?? 0);
    if (Date.now() - lastAttemptAt < REFRESH_COOLDOWN_MS) return;
    void this.refreshInBackground(accountId);
  }

  refreshInBackground(accountId: string): Promise<boolean> {
    return this.singleFlight(accountId, async () => {
      try {
        return await this.refreshOnce(accountId);
      } catch (error) {
        const account = this.database.accounts.get(accountId);
        if (!account || !account.enabled) throw error;
        await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs()));
        return this.refreshOnce(accountId);
      }
    }).then(() => true).catch(() => false);
  }

  private refreshOnce(accountId: string): Promise<RateLimitSnapshot> {
    this.lastAttemptAt.set(accountId, Date.now());
    return (async () => {
      const account = this.database.accounts.get(accountId);
      if (!account) throw new Error("account_not_found");
      const result = await withAppServerClient(this.config, account.codexHome, (client) =>
        client.call("account/rateLimits/read", {}, 30_000));
      const limits = parseRateLimitResponse(result);
      this.database.accounts.updateRateLimits(accountId, limits);
      return limits;
    })();
  }

  private singleFlight(accountId: string, operation: () => Promise<RateLimitSnapshot>): Promise<RateLimitSnapshot> {
    const current = this.inFlight.get(accountId);
    if (current) return current;
    const next = operation();
    this.inFlight.set(accountId, next);
    void next.finally(() => {
      if (this.inFlight.get(accountId) === next) this.inFlight.delete(accountId);
    }).catch(() => undefined);
    return next;
  }

  private retryDelayMs(): number {
    return BACKGROUND_RETRY_DELAY_MS * (0.8 + Math.random() * 0.4);
  }
}
