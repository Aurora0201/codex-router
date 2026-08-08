import type { AccountRecord, RoutingIdentity, Transport } from "../types.js";
import { GatewayDatabase } from "../db/database.js";

export class SessionBindingService {
  constructor(private readonly database: GatewayDatabase) {}

  validateBoundAccount(accountId: string): AccountRecord {
    const account = this.database.accounts.get(accountId);
    if (!account) throw new Error("bound_account_missing");
    if (!account.enabled) throw new Error("bound_account_disabled");
    if (account.authStatus !== "ready" && account.authStatus !== "rate_limited") throw new Error("bound_account_not_ready");
    if (account.fedRamp) throw new Error("fedramp_accounts_not_supported");
    this.database.accounts.markUsed(account.id);
    return account;
  }

  findBoundAccount(identity: RoutingIdentity): AccountRecord | null {
    const existing = this.database.sessions.findByRoutingKey(identity.routingKey);
    if (!existing) return null;
    this.database.sessions.touchBinding(identity.routingKey);
    return this.validateBoundAccount(existing.accountId);
  }

  bind(identity: RoutingIdentity, transport: Transport, account: AccountRecord): AccountRecord {
    this.database.sessions.createBinding(identity, transport, account.id);
    return account;
  }
}
