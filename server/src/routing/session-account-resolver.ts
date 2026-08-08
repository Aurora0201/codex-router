import type { AccountRecord, RoutingIdentity, Transport } from "../types.js";
import { GatewayDatabase } from "../db/database.js";
import { ActiveAccountService } from "./active-account-service.js";
import { SessionBindingService } from "./session-binding-service.js";

export class SessionAccountResolver {
  constructor(
    private readonly database: GatewayDatabase,
    private readonly activeAccounts: ActiveAccountService,
    private readonly bindings: SessionBindingService,
  ) {}

  resolve(identity: RoutingIdentity, transport: Transport): AccountRecord {
    const existing = this.bindings.findBoundAccount(identity);
    if (existing) return existing;

    const active = this.activeAccounts.get();
    if (!active) throw new Error("no_active_account_selected");
    return this.bindings.bind(identity, transport, active);
  }

  selectCatalog(): AccountRecord {
    const active = this.activeAccounts.get();
    if (!active || !active.enabled || active.authStatus !== "ready") throw new Error("no_active_account_selected");
    if (active.fedRamp) throw new Error("fedramp_accounts_not_supported");
    this.database.accounts.markUsed(active.id);
    return active;
  }
}
