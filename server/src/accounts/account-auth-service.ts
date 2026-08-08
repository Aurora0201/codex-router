import type { GatewayConfig } from "../types.js";
import type { CredentialSnapshot } from "../types.js";
import { GatewayDatabase } from "../db/database.js";
import { AccountOperationLock } from "./account-lock.js";
import { withAppServerClient } from "./app-server-client.js";
import { CredentialReader } from "./credential-reader.js";

export class AccountAuthService {
  private readonly reader = new CredentialReader();
  private readonly lock = new AccountOperationLock();

  constructor(
    private readonly config: GatewayConfig,
    private readonly database: GatewayDatabase,
  ) {}

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
    return this.lock.run(accountId, async () => {
      const account = this.database.accounts.get(accountId);
      if (!account) throw new Error("account_not_found");
      this.database.accounts.update(accountId, { authStatus: "refreshing" });
      try {
        await withAppServerClient(this.config, account.codexHome, (client) => client.call("account/read", { refreshToken: true }, 60_000));
        const credential = await this.reader.read(account.codexHome);
        if (credential.fedRamp) {
          this.database.accounts.update(accountId, { fedRamp: true, authStatus: "unsupported_fedramp", enabled: false });
          throw new Error("fedramp_accounts_not_supported");
        }
        this.database.accounts.update(accountId, { email: credential.email, planType: credential.planType, authStatus: "ready" });
        this.database.accounts.markAuthRefreshed(accountId);
        return credential;
      } catch (error) {
        if ((error as Error).message !== "fedramp_accounts_not_supported") {
          this.database.accounts.update(accountId, { authStatus: "relogin_required" });
        }
        throw error;
      }
    });
  }
}
