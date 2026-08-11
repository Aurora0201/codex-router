import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
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
  private readonly cleanupTasks = new Map<string, Promise<void>>();

  constructor(
    private readonly config: GatewayConfig,
    private readonly database: GatewayDatabase,
  ) {}

  async start(): Promise<LoginSessionView> {
    const stagingUuid = randomUUID();
    const stagingRoot = path.join(this.config.loginStagingDir, stagingUuid);
    const stagingHome = path.join(stagingRoot, "codex-home");
    await mkdir(stagingHome, { recursive: true });
    await writeFile(
      path.join(stagingHome, "config.toml"),
      'cli_auth_credentials_store = "file"\n\n[features]\nplugins = false\n',
      { flag: "wx" },
    );

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
              void client.close().then(() => this.scheduleStagingCleanup(session)).catch(() => undefined);
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
      this.scheduleStagingCleanup({ stagingHome } as LoginSession);
      throw new Error("account_login_start_failed", { cause: error });
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
          this.scheduleStagingCleanup(session);
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
      this.scheduleStagingCleanup(session);
    }
  }

  list(): LoginSessionView[] {
    return [...this.logins.values()].map((session) => this.view(session));
  }

  async close(): Promise<void> {
    const sessions = [...this.logins.values()];
    await Promise.all(sessions.map((session) => session.client.close()));
    for (const session of sessions) this.scheduleStagingCleanup(session);
    this.logins.clear();
    if (this.cleanupTasks.size > 0) {
      await Promise.race([
        Promise.allSettled([...this.cleanupTasks.values()]),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
  }

  async cleanupStaleStaging(): Promise<void> {
    await mkdir(this.config.loginStagingDir, { recursive: true });
    const entries = await readdir(this.config.loginStagingDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      void this.removeTree(path.join(this.config.loginStagingDir, entry.name)).catch(() => undefined);
    }
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
    let promoted = false;
    try {
      const credential = await this.reader.read(session.stagingHome);
      if (credential.fedRamp) {
        session.status = "failed";
        session.error = "fedramp_accounts_not_supported";
        await session.client.close();
        this.scheduleStagingCleanup(session);
        return;
      }
      const existing = this.database.accounts.findByChatgptAccountId(credential.accountId);
      if (existing) {
        session.status = "failed";
        session.error = "account_already_exists";
        await session.client.close();
        this.scheduleStagingCleanup(session);
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

      // Commit a validated copy before treating staging cleanup as best-effort.
      // Child processes can retain Windows handles below CODEX_HOME after the
      // app-server exits, so login success must not depend on deleting staging.
      await session.client.close();
      await this.promoteStagingToAccount(session, credential.accountId);
      promoted = true;
      this.database.raw.transaction(() => {
        this.database.accounts.insert({ id: session.stagingUuid, codexHome: session.accountCodexHome });
        this.database.accounts.update(session.stagingUuid, {
          chatgptAccountId: credential.accountId,
          email: stringAt(official, "email") ?? credential.email,
          planType: stringAt(official, "planType", "plan_type") ?? credential.planType,
          authStatus: "ready",
        });
        if (limits) this.database.accounts.updateRateLimits(session.stagingUuid, limits);
        this.database.accounts.markAuthRefreshed(session.stagingUuid);
      })();

      session.createdAccountId = session.stagingUuid;
      session.status = "complete";
      this.scheduleStagingCleanup(session);
    } catch (error) {
      session.status = "failed";
      session.error = this.loginErrorCode(error);
      await session.client.close();
      if (promoted) await this.removeTree(path.dirname(session.accountCodexHome)).catch(() => undefined);
      this.scheduleStagingCleanup(session);
    } finally {
      await session.client.close();
    }
  }

  private async promoteStagingToAccount(session: LoginSession, expectedAccountId: string): Promise<void> {
    const target = session.accountCodexHome;
    const accountRoot = path.dirname(target);
    const promoting = path.join(accountRoot, ".codex-home-promoting");
    await mkdir(accountRoot, { recursive: true });
    await this.removeTree(promoting).catch(() => undefined);
    try {
      await cp(session.stagingHome, promoting, {
        recursive: true,
        filter: (source) => {
          const relative = path.relative(session.stagingHome, source);
          if (!relative) return true;
          const root = relative.split(path.sep)[0];
          return root !== ".tmp" && root !== "tmp";
        },
      });
      const copied = await this.reader.read(promoting);
      if (copied.accountId !== expectedAccountId) throw new Error("promoted_account_mismatch");
      await this.removeTree(target).catch(() => undefined);
      await rename(promoting, target);
    } catch {
      await this.removeTree(promoting).catch(() => undefined);
      throw new Error("account_promotion_failed");
    }
  }

  private async cleanupStaging(session: LoginSession): Promise<void> {
    const root = path.resolve(session.stagingHome, "..");
    const expectedRoot = path.resolve(this.config.loginStagingDir);
    if (path.dirname(root) !== expectedRoot) return;
    await this.removeTree(root);
  }

  private scheduleStagingCleanup(session: LoginSession): void {
    const root = path.resolve(session.stagingHome, "..");
    if (this.cleanupTasks.has(root)) return;
    const task = this.cleanupStaging(session).catch(() => undefined).finally(() => {
      this.cleanupTasks.delete(root);
    });
    this.cleanupTasks.set(root, task);
  }

  private removeTree(target: string): Promise<void> {
    return rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }

  private loginErrorCode(error: unknown): string {
    const code = (error as Error).message;
    if (code === "account_promotion_failed") return code;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "credential_read_failed";
    return "account_login_finalize_failed";
  }
}

