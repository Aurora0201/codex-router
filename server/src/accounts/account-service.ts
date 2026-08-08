import { rm } from "node:fs/promises";
import path from "node:path";
import type { AccountRecord, GatewayConfig } from "../types.js";
import { GatewayDatabase } from "../db/database.js";
export class AccountService {
  constructor(
    private readonly config: GatewayConfig,
    private readonly database: GatewayDatabase,
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
    const updated = this.database.accounts.update(id, { enabled, authStatus: enabled ? "ready" : "disabled" });
    if (!enabled && this.database.getActiveAccountId() === id) {
      this.database.setActiveAccountId(null);
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
    if (this.database.getActiveAccountId() === id) this.database.setActiveAccountId(null);
    await rm(accountRoot, { recursive: true, force: false });
  }
}
