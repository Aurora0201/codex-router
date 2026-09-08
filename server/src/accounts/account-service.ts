import { rm } from "node:fs/promises";
import path from "node:path";
import type { AccountRecord, GatewayConfig } from "../types.js";
import { GatewayDatabase } from "../db/database.js";
import type { ActiveAccountService } from "../routing/active-account-service.js";
import { AccountOperationLock } from "./account-lock.js";

export class AccountService {
  private readonly removals = new Map<string, Promise<void>>();
  constructor(
    private readonly config: GatewayConfig,
    private readonly database: GatewayDatabase,
    private readonly activeAccounts?: ActiveAccountService,
    private readonly lock = new AccountOperationLock(),
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
    if (enabled && this.removals.has(id)) throw new Error("account_removal_in_progress");
    const account = this.database.accounts.get(id);
    if (!account) throw new Error("account_not_found");
    const updated = this.database.accounts.update(id, { enabled, authStatus: enabled ? "checking" : "disabled", authErrorCode: null });
    if (!enabled && this.database.getActiveAccountId() === id) {
      this.clearActiveAccount();
    }
    return updated;
  }

  async remove(id: string): Promise<void> {
    const pending = this.removals.get(id);
    if (pending) return pending;
    const account = this.database.accounts.get(id);
    if (!account) throw new Error("account_not_found");
    const accountRoot = path.resolve(account.codexHome, "..");
    const expectedRoot = path.resolve(this.config.accountsDir);
    if (path.dirname(accountRoot) !== expectedRoot) throw new Error("unsafe_account_path");
    // Keep a disabled row until credentials are gone, so a filesystem failure
    // is retryable. The shared lock lets an existing app-server release handles.
    this.setEnabled(id, false);
    const operation = this.lock.run(id, async () => {
      this.setEnabled(id, false);
      try {
        await rm(accountRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) {
        throw new Error("account_removal_failed", { cause: error });
      }
      this.database.accounts.delete(id);
    });
    this.removals.set(id, operation);
    try { await operation; }
    finally { this.removals.delete(id); }
  }

  private clearActiveAccount(): void {
    if (this.activeAccounts) this.activeAccounts.clear();
    else this.database.setActiveAccountId(null);
  }
}
