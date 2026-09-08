import type { RateLimitSnapshot } from "../types.js";
import { AccountStatusService } from "./account-status-service.js";

export class AccountUsageService {
  constructor(
    // Required. Falling back to a fresh one built a second service with its own
    // lock and cooldown, owned by nobody and closed by nobody.
    private readonly status: AccountStatusService,
    private readonly backgroundRefreshEnabled = true,
  ) {}

  refresh(accountId: string): Promise<RateLimitSnapshot> {
    return this.status.refresh(accountId).then((result) => result.limits);
  }

  refreshIfStale(accountId: string): void {
    if (!this.backgroundRefreshEnabled) return;
    this.status.refreshIfStale(accountId);
  }

  refreshInBackground(accountId: string): Promise<boolean> {
    if (!this.backgroundRefreshEnabled) return Promise.resolve(false);
    return this.status.refreshInBackground(accountId);
  }
}
