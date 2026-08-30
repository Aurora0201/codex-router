import type { GatewayConfig } from "../types.js";
import type { CredentialSnapshot } from "../types.js";
import { GatewayDatabase } from "../db/database.js";
import { AccountStatusService } from "./account-status-service.js";
import { CredentialReader } from "./credential-reader.js";

export class AccountAuthService {
  private readonly reader = new CredentialReader();
  private readonly status: AccountStatusService;

  constructor(
    config: GatewayConfig,
    private readonly database: GatewayDatabase,
    status?: AccountStatusService,
  ) {
    this.status = status ?? new AccountStatusService(config, database);
  }

  async getCredential(accountId: string): Promise<CredentialSnapshot> {
    const account = this.database.accounts.get(accountId);
    if (!account) throw new Error("account_not_found");
    if (!account.enabled) throw new Error("account_disabled");
    const snapshot = await this.reader.read(account.codexHome);
    if (snapshot.fedRamp || account.fedRamp) {
      this.database.accounts.update(accountId, { fedRamp: true, authStatus: "unsupported_fedramp", enabled: false });
      throw new Error("fedramp_accounts_not_supported");
    }
    return snapshot;
  }

  refresh(accountId: string): Promise<CredentialSnapshot> {
    return this.status.refresh(accountId, { refreshToken: true, checking: true })
      .then((result) => result.credential);
  }
}
