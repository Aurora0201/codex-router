import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { AccountRecord, GatewayConfig } from "../types.js";
import { GatewayDatabase } from "../db/database.js";
import type { ActiveAccountService } from "../routing/active-account-service.js";
import { AccountOperationLock } from "./account-lock.js";

/** The shape `AccountLoginService` gives every account directory it creates. */
const UUID_DIRECTORY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  /**
   * Account directories with no row behind them, swept at startup.
   *
   * A login writes the directory before it writes the row: `promoteStaging-
   * ToAccount` renames the credentials into place and the insert happens
   * afterwards. The `finally` that undoes a half-finished login only runs on
   * an exception, so a crash or a kill in that window leaves a directory
   * holding a real `auth.json` that nothing owns and that removing the
   * account can never reach.
   *
   * Startup is the one moment this is safe without a lock: no login can be in
   * flight yet, so anything without a row is finished garbage. Two further
   * guards, because this deletes credentials: the name has to look like the
   * uuid a login would have made, and the directory has to sit directly under
   * the configured accounts root.
   */
  async cleanupOrphanDirectories(): Promise<string[]> {
    const root = path.resolve(this.config.accountsDir);
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    const known = new Set(this.database.accounts.list().map((account) => account.id));
    const removed: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || known.has(entry.name) || !UUID_DIRECTORY.test(entry.name)) continue;
      const target = path.join(root, entry.name);
      if (path.dirname(target) !== root) continue;
      try {
        await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        removed.push(entry.name);
      } catch {
        // A directory another process still holds open is retried next start.
      }
    }
    return removed;
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
