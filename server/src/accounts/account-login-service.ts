import { randomUUID } from "node:crypto";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GatewayConfig, RateLimitSnapshot } from "../types.js";
import { GatewayDatabase } from "../db/database.js";
import { AppServerClient } from "./app-server-client.js";
import { CredentialReader } from "./credential-reader.js";
import { object, parseRateLimitResponse, stringAt } from "./rate-limit-parser.js";

export interface LoginSessionView {
  loginId: string;
  authUrl: string;
  status: "waiting" | "complete" | "failed" | "cancelled";
  error?: string;
  createdAccountId?: string;
}

interface LoginSession {
  loginId: string;
  stagingUuid: string;
  stagingHome: string;
  accountCodexHome: string;
  authUrl: string;
  status: "waiting" | "complete" | "failed" | "cancelled";
  error?: string;
  createdAccountId?: string;
  client: AppServerClient;
  completing?: Promise<void>;
}

export class AccountLoginService {
  private readonly reader = new CredentialReader();
  private readonly logins = new Map<string, LoginSession>();

  constructor(
    private readonly config: GatewayConfig,
    private readonly database: GatewayDatabase,
  ) {}

  async start(): Promise<LoginSessionView> {
    const stagingUuid = randomUUID();
    const stagingRoot = path.join(this.config.loginStagingDir, stagingUuid);
    const stagingHome = path.join(stagingRoot, "codex-home");
    await mkdir(stagingHome, { recursive: true });
    await writeFile(path.join(stagingHome, "config.toml"), 'cli_auth_credentials_store = "file"\n', { flag: "wx" });

    const client = new AppServerClient(this.config.codexCliPath, stagingHome, this.config.codexCliArgs);
    try {
      await client.start();
      const result = await client.call("account/login/start", { type: "chatgpt" }, 30_000);
      const loginId = stringAt(result, "loginId", "login_id") ?? randomUUID();
      const authUrl = stringAt(result, "authUrl", "auth_url", "url");
      if (!authUrl) throw new Error("codex_app_server_missing_auth_url");
      const session: LoginSession = {
        loginId,
        stagingUuid,
        stagingHome,
        accountCodexHome: path.join(this.config.accountsDir, stagingUuid, "codex-home"),
        authUrl,
        status: "waiting",
        client,
      };
      client.on("notification", (method: string, params: unknown) => {
        if (method === "account/login/completed") {
          const completedId = stringAt(params, "loginId", "login_id");
          if (!completedId || completedId === loginId) {
            if (object(params).success === false) {
              session.status = "failed";
              session.error = "oauth_login_failed";
              void client.close().then(() => this.cleanupStaging(session)).catch(() => undefined);
            } else {
              void this.completeLogin(session);
            }
          }
        }
      });
      this.logins.set(loginId, session);
      return { loginId, authUrl, status: session.status };
    } catch (error) {
      await client.close();
      await this.cleanupStaging({ stagingHome } as LoginSession);
      throw error;
    }
  }

  async getStatus(loginId: string): Promise<LoginSessionView> {
    const session = this.logins.get(loginId);
    if (!session) throw new Error("login_not_found");
    if (session.status === "waiting") {
      try {
        await this.reader.read(session.stagingHome);
        await this.completeLogin(session);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          session.status = "failed";
          session.error = "credential_read_failed";
          await session.client.close();
          await this.cleanupStaging(session);
        }
      }
    }
    return this.view(session);
  }

  async cancel(loginId: string): Promise<void> {
    const session = this.logins.get(loginId);
    if (!session) throw new Error("login_not_found");
    try {
      await session.client.call("account/login/cancel", { loginId }, 10_000);
    } catch {
      // Cancellation is best-effort; the staging workspace still gets removed.
    } finally {
      session.status = "cancelled";
      await session.client.close();
      await this.cleanupStaging(session);
    }
  }

  list(): LoginSessionView[] {
    return [...this.logins.values()].map((session) => this.view(session));
  }

  async close(): Promise<void> {
    await Promise.all([...this.logins.values()].map((session) => session.client.close()));
    this.logins.clear();
  }

  private view(session: LoginSession): LoginSessionView {
    return {
      loginId: session.loginId,
      authUrl: session.authUrl,
      status: session.status,
      error: session.error,
      createdAccountId: session.createdAccountId,
    };
  }

  private completeLogin(session: LoginSession): Promise<void> {
    if (session.status !== "waiting") return Promise.resolve();
    if (!session.completing) {
      session.completing = this.completeLoginInner(session).finally(() => {
        session.completing = undefined;
      });
    }
    return session.completing;
  }

  private async completeLoginInner(session: LoginSession): Promise<void> {
    try {
      const credential = await this.reader.read(session.stagingHome);
      if (credential.fedRamp) {
        session.status = "failed";
        session.error = "fedramp_accounts_not_supported";
        await this.cleanupStaging(session);
        return;
      }
      const existing = this.database.accounts.findByChatgptAccountId(credential.accountId);
      if (existing) {
        session.status = "failed";
        session.error = "account_already_exists";
        await this.cleanupStaging(session);
        return;
      }

      let official: Record<string, unknown> = {};
      try {
        const accountResult = await session.client.call("account/read", { refreshToken: false }, 15_000);
        official = object(object(accountResult).account ?? accountResult);
      } catch {
        // JWT claims remain a safe metadata fallback when account/read is temporarily unavailable.
      }

      let limits: RateLimitSnapshot | null = null;
      try {
        const limitsResult = await session.client.call("account/rateLimits/read", {}, 15_000);
        limits = parseRateLimitResponse(limitsResult);
      } catch {
        // Login is complete even when a separate rate-limit read is temporarily unavailable.
      }

      // The app-server process holds the staging CODEX_HOME directory handle on
      // Windows; it must be closed before the directory is moved, otherwise the
      // move fails with EPERM. `close()` is idempotent, so the later `finally`
      // call is harmless. Even after the app-server exits, grandchild processes
      // (plugin git clones, sandboxes) can briefly retain handles, so we copy
      // the directory instead of renaming it and retry on transient lock errors.
      await session.client.close();
      await this.moveStagingToAccount(session);
      this.database.accounts.insert({ id: session.stagingUuid, codexHome: session.accountCodexHome });
      this.database.accounts.update(session.stagingUuid, {
        chatgptAccountId: credential.accountId,
        email: stringAt(official, "email") ?? credential.email,
        planType: stringAt(official, "planType", "plan_type") ?? credential.planType,
        authStatus: "ready",
      });
      if (limits) this.database.accounts.updateRateLimits(session.stagingUuid, limits);
      this.database.accounts.markAuthRefreshed(session.stagingUuid);

      session.createdAccountId = session.stagingUuid;
      session.status = "complete";
    } catch (error) {
      session.status = "failed";
      session.error = (error as Error).message ?? "credential_read_failed";
      await session.client.close();
      await this.cleanupStaging(session);
    } finally {
      await session.client.close();
    }
  }

  private async moveStagingToAccount(session: LoginSession): Promise<void> {
    const target = session.accountCodexHome;
    await mkdir(path.dirname(target), { recursive: true });
    await rm(target, { recursive: true, force: true });
    const maxAttempts = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        await cp(session.stagingHome, target, { recursive: true });
        await rm(session.stagingHome, { recursive: true, force: true });
        await rm(path.dirname(session.stagingHome), { recursive: true, force: true });
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const retryable = code === "EPERM" || code === "EBUSY" || code === "ENOTEMPTY" || code === "EACCES";
        if (!retryable || attempt >= maxAttempts) throw error;
        // Grandchild processes (plugin git clones, sandboxes, SQLite WAL
        // checkpoints) release their CODEX_HOME handles a few seconds after the
        // app-server exits. Back off and try again before surfacing the failure.
        await new Promise((resolve) => setTimeout(resolve, 2_500));
      }
    }
  }

  private async cleanupStaging(session: LoginSession): Promise<void> {
    const root = path.resolve(session.stagingHome, "..");
    const expectedRoot = path.resolve(this.config.loginStagingDir);
    if (path.dirname(root) !== expectedRoot) return;
    try {
      await rm(root, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

