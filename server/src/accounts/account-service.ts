import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GatewayConfig, RateLimitSnapshot, RateLimitWindow } from "../types.js";
import { GatewayDatabase } from "../db/database.js";
import { AccountOperationLock } from "./account-lock.js";
import { AppServerClient } from "./app-server-client.js";
import { CredentialReader } from "./credential-reader.js";

interface LoginSession {
  loginId: string;
  accountId: string;
  authUrl: string;
  status: "waiting" | "complete" | "failed" | "cancelled";
  error?: string;
  client: AppServerClient;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringAt(value: unknown, ...keys: string[]): string | null {
  const source = object(value);
  for (const key of keys) if (typeof source[key] === "string") return source[key] as string;
  return null;
}

function numberAt(value: unknown, ...keys: string[]): number | null {
  const source = object(value);
  for (const key of keys) if (typeof source[key] === "number") return source[key] as number;
  return null;
}

function windowFrom(value: unknown): RateLimitWindow | null {
  const source = object(value);
  if (Object.keys(source).length === 0) return null;
  return {
    usedPercent: numberAt(source, "usedPercent", "used_percent"),
    resetsAt: numberAt(source, "resetsAt", "resets_at"),
    windowDurationMins: numberAt(source, "windowDurationMins", "window_duration_mins"),
  };
}

function parseRateLimits(result: unknown): RateLimitSnapshot {
  const root = object(result);
  const limits = object(root.rateLimits ?? root.rate_limits ?? result);
  return {
    primary: windowFrom(limits.primary),
    secondary: windowFrom(limits.secondary),
    loadedAt: Date.now(),
  };
}

export class AccountService {
  private readonly reader = new CredentialReader();
  private readonly lock = new AccountOperationLock();
  private readonly logins = new Map<string, LoginSession>();

  constructor(
    private readonly config: GatewayConfig,
    private readonly database: GatewayDatabase,
  ) {}

  list() {
    return this.database.listAccounts();
  }

  async startBrowserLogin(label: string): Promise<Omit<LoginSession, "client">> {
    const normalized = label.trim();
    if (normalized.length < 1 || normalized.length > 80) throw new Error("invalid_account_label");
    const accountId = randomUUID();
    const codexHome = path.join(this.config.accountsDir, accountId, "codex-home");
    await mkdir(codexHome, { recursive: true });
    await writeFile(path.join(codexHome, "config.toml"), 'cli_auth_credentials_store = "file"\n', { flag: "wx" });
    this.database.createAccount({ id: accountId, label: normalized, codexHome });

    const client = new AppServerClient(this.config.codexCliPath, codexHome, this.config.codexCliArgs);
    try {
      await client.start();
      const result = await client.call("account/login/start", { type: "chatgpt" }, 30_000);
      const loginId = stringAt(result, "loginId", "login_id") ?? randomUUID();
      const authUrl = stringAt(result, "authUrl", "auth_url", "url");
      if (!authUrl) throw new Error("codex_app_server_missing_auth_url");
      const session: LoginSession = { loginId, accountId, authUrl, status: "waiting", client };
      client.on("notification", (method: string, params: unknown) => {
        if (method === "account/login/completed") {
          const completedId = stringAt(params, "loginId", "login_id");
          if (!completedId || completedId === loginId) {
            if (object(params).success === false) {
              session.status = "failed";
              session.error = "oauth_login_failed";
              this.database.updateAccount(accountId, { authStatus: "relogin_required", enabled: false });
              void client.close();
            } else {
              void this.completeLogin(session);
            }
          }
        }
      });
      this.logins.set(loginId, session);
      return { loginId, accountId, authUrl, status: session.status };
    } catch (error) {
      this.database.updateAccount(accountId, { authStatus: "error", enabled: false });
      await client.close();
      throw error;
    }
  }

  async getLoginStatus(loginId: string): Promise<Omit<LoginSession, "client">> {
    const session = this.logins.get(loginId);
    if (!session) throw new Error("login_not_found");
    if (session.status === "waiting") {
      try {
        await this.reader.read(this.database.getAccount(session.accountId)!.codexHome);
        await this.completeLogin(session);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          session.status = "failed";
          session.error = "credential_read_failed";
          this.database.updateAccount(session.accountId, { authStatus: "error", enabled: false });
          await session.client.close();
        }
      }
    }
    return {
      loginId: session.loginId,
      accountId: session.accountId,
      authUrl: session.authUrl,
      status: session.status,
      error: session.error,
    };
  }

  async cancelLogin(loginId: string): Promise<void> {
    const session = this.logins.get(loginId);
    if (!session) throw new Error("login_not_found");
    try {
      await session.client.call("account/login/cancel", { loginId }, 10_000);
    } finally {
      session.status = "cancelled";
      this.database.updateAccount(session.accountId, { authStatus: "disabled", enabled: false });
      await session.client.close();
    }
  }

  async getCredential(accountId: string) {
    const account = this.database.getAccount(accountId);
    if (!account) throw new Error("account_not_found");
    if (!account.enabled) throw new Error("account_disabled");
    const snapshot = await this.reader.read(account.codexHome);
    if (snapshot.fedRamp || account.fedRamp) {
      this.database.updateAccount(accountId, { fedRamp: true, authStatus: "unsupported_fedramp", enabled: false });
      throw new Error("fedramp_accounts_not_supported");
    }
    return snapshot;
  }

  refreshAuth(accountId: string) {
    return this.lock.run(accountId, async () => {
      const account = this.database.getAccount(accountId);
      if (!account) throw new Error("account_not_found");
      this.database.updateAccount(accountId, { authStatus: "refreshing" });
      try {
        await this.withClient(account.codexHome, (client) => client.call("account/read", { refreshToken: true }, 60_000));
        const credential = await this.reader.read(account.codexHome);
        if (credential.fedRamp) {
          this.database.updateAccount(accountId, { fedRamp: true, authStatus: "unsupported_fedramp", enabled: false });
          throw new Error("fedramp_accounts_not_supported");
        }
        this.database.updateAccount(accountId, { email: credential.email, planType: credential.planType, authStatus: "ready" });
        this.database.markAuthRefreshed(accountId);
        return credential;
      } catch (error) {
        if ((error as Error).message !== "fedramp_accounts_not_supported") {
          this.database.updateAccount(accountId, { authStatus: "relogin_required" });
        }
        throw error;
      }
    });
  }

  refreshRateLimits(accountId: string): Promise<RateLimitSnapshot> {
    return this.lock.run(accountId, async () => {
      const account = this.database.getAccount(accountId);
      if (!account) throw new Error("account_not_found");
      const result = await this.withClient(account.codexHome, (client) => client.call("account/rateLimits/read", {}, 30_000));
      const limits = parseRateLimits(result);
      this.database.updateRateLimits(accountId, limits);
      return limits;
    });
  }

  update(accountId: string, values: { label?: string; enabled?: boolean }) {
    if (values.label !== undefined && (values.label.trim().length < 1 || values.label.length > 80)) throw new Error("invalid_account_label");
    const account = this.database.getAccount(accountId);
    if (!account) throw new Error("account_not_found");
    return this.database.updateAccount(accountId, {
      ...(values.label === undefined ? {} : { label: values.label.trim() }),
      ...(values.enabled === undefined ? {} : { enabled: values.enabled, authStatus: values.enabled ? "ready" : "disabled" }),
    });
  }

  setDefault(accountId: string) {
    return this.database.setDefaultAccount(accountId);
  }

  async remove(accountId: string): Promise<void> {
    const account = this.database.getAccount(accountId);
    if (!account) throw new Error("account_not_found");
    const accountRoot = path.resolve(account.codexHome, "..");
    const expectedRoot = path.resolve(this.config.accountsDir);
    if (path.dirname(accountRoot) !== expectedRoot) throw new Error("unsafe_account_path");
    this.database.deleteAccount(accountId);
    await rm(accountRoot, { recursive: true, force: false });
  }

  async close(): Promise<void> {
    await Promise.all([...this.logins.values()].map((session) => session.client.close()));
    this.logins.clear();
  }

  private async completeLogin(session: LoginSession): Promise<void> {
    if (session.status !== "waiting") return;
    try {
      const credential = await this.reader.read(this.database.getAccount(session.accountId)!.codexHome);
      if (credential.fedRamp) {
        this.database.updateAccount(session.accountId, { fedRamp: true, authStatus: "unsupported_fedramp", enabled: false });
        session.status = "failed";
        session.error = "fedramp_accounts_not_supported";
      } else {
        let official: Record<string, unknown> = {};
        try {
          const accountResult = await session.client.call("account/read", { refreshToken: false }, 15_000);
          official = object(object(accountResult).account ?? accountResult);
        } catch {
          // JWT claims remain a safe metadata fallback when account/read is temporarily unavailable.
        }
        this.database.updateAccount(session.accountId, {
          email: stringAt(official, "email") ?? credential.email,
          planType: stringAt(official, "planType", "plan_type") ?? credential.planType,
          authStatus: "ready",
        });
        this.database.markAuthRefreshed(session.accountId);
        session.status = "complete";
        try {
          const result = await session.client.call("account/rateLimits/read", {}, 15_000);
          this.database.updateRateLimits(session.accountId, parseRateLimits(result));
        } catch {
          // Login is complete even when a separate rate-limit read is temporarily unavailable.
        }
      }
    } catch {
      session.status = "failed";
      session.error = "credential_read_failed";
      this.database.updateAccount(session.accountId, { authStatus: "error", enabled: false });
    } finally {
      await session.client.close();
    }
  }

  private async withClient<T>(codexHome: string, operation: (client: AppServerClient) => Promise<T>): Promise<T> {
    const client = new AppServerClient(this.config.codexCliPath, codexHome, this.config.codexCliArgs);
    try {
      await client.start();
      return await operation(client);
    } finally {
      await client.close();
    }
  }
}
