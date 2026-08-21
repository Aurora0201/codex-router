import type { GatewayConfig, RateLimitSnapshot } from "../types.js";
import { GatewayDatabase } from "../db/database.js";
import { AccountStatusService } from "./account-status-service.js";

export class AccountUsageService {
  private readonly status: AccountStatusService;

  constructor(
    config: GatewayConfig,
    database: GatewayDatabase,
    status?: AccountStatusService,
  ) {
    this.status = status ?? new AccountStatusService(config, database);
  }

  refresh(accountId: string): Promise<RateLimitSnapshot> {
    return this.refreshOnce(accountId);
  }

  refreshIfStale(accountId: string): void {
    this.status.refreshIfStale(accountId);
  }

  refreshInBackground(accountId: string): Promise<boolean> {
    return this.refresh(accountId).then(() => true).catch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return this.refresh(accountId).then(() => true).catch(() => false);
    });
  }

  private refreshOnce(accountId: string): Promise<RateLimitSnapshot> {
    return this.status.refresh(accountId).then((result) => result.limits);
  }
}
