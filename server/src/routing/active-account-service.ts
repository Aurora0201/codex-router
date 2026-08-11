import type { AccountRecord } from "../types.js";
import { GatewayDatabase } from "../db/database.js";

export type ActiveAccountChangeListener = (previousAccountId: string | null, accountId: string | null) => void;

export class ActiveAccountService {
  private readonly listeners = new Set<ActiveAccountChangeListener>();

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
    const previousAccountId = this.database.getActiveAccountId();
    this.database.setActiveAccountId(accountId);
    this.emitChange(previousAccountId, accountId);
    return account;
  }

  clear(): void {
    const previousAccountId = this.database.getActiveAccountId();
    this.database.setActiveAccountId(null);
    this.emitChange(previousAccountId, null);
  }

  onChange(listener: ActiveAccountChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitChange(previousAccountId: string | null, accountId: string | null): void {
    if (previousAccountId === accountId) return;
    for (const listener of this.listeners) listener(previousAccountId, accountId);
  }
}
