import type { GatewayConfig, RateLimitSnapshot } from "../types.js";
import { GatewayDatabase } from "../db/database.js";
import { AccountStatusService } from "./account-status-service.js";

export class AccountUsageService {
  private readonly status: AccountStatusService;

  constructor(
    config: GatewayConfig,
    database: GatewayDatabase,
    status?: AccountStatusService,
    private readonly backgroundRefreshEnabled = true,
  ) {
    this.status = status ?? new AccountStatusService(config, database);
  }

  refresh(accountId: string): Promise<RateLimitSnapshot> {
    return this.refreshOnce(accountId);
  }

  refreshIfStale(accountId: string): void {
    if (!this.backgroundRefreshEnabled) return;
    this.status.refreshIfStale(accountId);
  }

  refreshInBackground(accountId: string): Promise<boolean> {
    if (!this.backgroundRefreshEnabled) return Promise.resolve(false);
    return this.status.refreshInBackground(accountId);
  }

  private refreshOnce(accountId: string): Promise<RateLimitSnapshot> {
    return this.status.refresh(accountId).then((result) => result.limits);
  }
}
