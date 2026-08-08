import type { AccountRecord } from "../types.js";
import { GatewayDatabase } from "../db/database.js";

export class ActiveAccountService {
  constructor(private readonly database: GatewayDatabase) {}

  get(): AccountRecord | null {
    const id = this.database.getActiveAccountId();
    if (!id) return null;
    const account = this.database.accounts.get(id);
    if (!account || !account.enabled) return null;
    return account;
  }

  select(accountId: string): AccountRecord {
    const account = this.database.accounts.get(accountId);
    if (!account) throw new Error("account_not_found");
    if (!account.enabled) throw new Error("account_disabled");
    if (account.authStatus !== "ready") throw new Error("account_not_ready");
    if (account.fedRamp) throw new Error("fedramp_accounts_not_supported");
    this.database.setActiveAccountId(accountId);
    return account;
  }

  clear(): void {
    this.database.setActiveAccountId(null);
  }
}
