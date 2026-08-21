import { rm } from "node:fs/promises";
import path from "node:path";
import type { AccountRecord, GatewayConfig } from "../types.js";
import { GatewayDatabase } from "../db/database.js";
import type { ActiveAccountService } from "../routing/active-account-service.js";
export class AccountService {
  constructor(
    private readonly config: GatewayConfig,
    private readonly database: GatewayDatabase,
    private readonly activeAccounts?: ActiveAccountService,
  ) {}

  list(): AccountRecord[] {
    return this.database.accounts.list();
  }

  get(id: string): AccountRecord {
    const account = this.database.accounts.get(id);
    if (!account) throw new Error("account_not_found");
    return account;
  }

  setEnabled(id: string, enabled: boolean): AccountRecord {
    const account = this.database.accounts.get(id);
    if (!account) throw new Error("account_not_found");
    const updated = this.database.accounts.update(id, { enabled, authStatus: enabled ? "checking" : "disabled", authErrorCode: null });
    if (!enabled && this.database.getActiveAccountId() === id) {
      this.clearActiveAccount();
    }
    return updated;
  }

  async remove(id: string): Promise<void> {
    const account = this.database.accounts.get(id);
    if (!account) throw new Error("account_not_found");
    const accountRoot = path.resolve(account.codexHome, "..");
    const expectedRoot = path.resolve(this.config.accountsDir);
    if (path.dirname(accountRoot) !== expectedRoot) throw new Error("unsafe_account_path");
    this.database.accounts.delete(id);
    if (this.database.getActiveAccountId() === id) this.clearActiveAccount();
    await rm(accountRoot, { recursive: true, force: false });
  }

  private clearActiveAccount(): void {
    if (this.activeAccounts) this.activeAccounts.clear();
    else this.database.setActiveAccountId(null);
  }
}
