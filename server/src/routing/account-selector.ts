import type { AccountRecord, RoutingIdentity, Transport } from "../types.js";
import { GatewayDatabase } from "../db/database.js";

export class AccountSelector {
  constructor(private readonly database: GatewayDatabase) {}

  select(identity: RoutingIdentity, transport: Transport): AccountRecord {
    const fallback = this.database.getDefaultAccount();
    if (!fallback) throw new Error("no_authenticated_account");
    const account = this.database.resolveBinding(identity, transport, fallback);
    if (!account.enabled) throw new Error("bound_account_disabled");
    if (account.authStatus !== "ready" && account.authStatus !== "rate_limited") throw new Error("bound_account_not_ready");
    if (account.fedRamp) throw new Error("fedramp_accounts_not_supported");
    this.database.markAccountUsed(account.id);
    return account;
  }

  selectCatalog(): AccountRecord {
    const account = this.database.getDefaultAccount();
    if (!account || !account.enabled || account.authStatus !== "ready") throw new Error("no_authenticated_account");
    if (account.fedRamp) throw new Error("fedramp_accounts_not_supported");
    this.database.markAccountUsed(account.id);
    return account;
  }
}
