import type { GatewayConfig, RateLimitSnapshot } from "../types.js";
import { GatewayDatabase } from "../db/database.js";
import { AccountOperationLock } from "./account-lock.js";
import { withAppServerClient } from "./app-server-client.js";
import { parseRateLimitResponse } from "./rate-limit-parser.js";

export class AccountUsageService {
  private readonly lock = new AccountOperationLock();

  constructor(
    private readonly config: GatewayConfig,
    private readonly database: GatewayDatabase,
  ) {}

  refresh(accountId: string): Promise<RateLimitSnapshot> {
    return this.lock.run(accountId, async () => {
      const account = this.database.accounts.get(accountId);
      if (!account) throw new Error("account_not_found");
      const result = await withAppServerClient(this.config, account.codexHome, (client) =>
        client.call("account/rateLimits/read", {}, 30_000));
      const limits = parseRateLimitResponse(result);
      this.database.accounts.updateRateLimits(accountId, limits);
      return limits;
    });
  }
}
