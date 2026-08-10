import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppServerClient } from "../src/accounts/app-server-client.js";
import { AccountService } from "../src/accounts/account-service.js";
import { AccountLoginService } from "../src/accounts/account-login-service.js";
import { AccountAuthService } from "../src/accounts/account-auth-service.js";
import { AccountUsageService } from "../src/accounts/account-usage-service.js";
import { CredentialReader } from "../src/accounts/credential-reader.js";
import { loadConfig } from "../src/config.js";
import { GatewayDatabase } from "../src/db/database.js";
import { buildUpstreamHeaders } from "../src/proxy/headers.js";
import { ActiveAccountService } from "../src/routing/active-account-service.js";
import { parseRateLimitResponse } from "../src/accounts/rate-limit-parser.js";
import Database from "better-sqlite3";

const temporary: string[] = [];
async function tempDir() { const dir = await mkdtemp(path.join(os.tmpdir(), "codex-router-test-")); temporary.push(dir); return dir; }
async function pathExists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}
afterEach(async () => Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("security and routing core", () => {
  it("rejects non-loopback binding and untrusted upstreams", () => {
    expect(() => loadConfig({ host: "0.0.0.0" as "127.0.0.1" })).toThrow(/loopback/);
    expect(() => loadConfig({ upstreamBaseUrl: "https://evil.test", developerMode: false })).toThrow(/custom upstream/i);
  });

  it("reads only the credential snapshot and recognizes FedRAMP", async () => {
    const home = await tempDir();
    const claims = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_user_email: "a@example.test", chatgpt_plan_type: "plus" } })).toString("base64url");
    await writeFile(path.join(home, "auth.json"), JSON.stringify({ tokens: { access_token: "secret", account_id: "acct-1", id_token: `x.${claims}.x`, refresh_token: "never-export" } }));
    const snapshot = await new CredentialReader().read(home);
    expect(snapshot).toMatchObject({ accessToken: "secret", accountId: "acct-1", email: "a@example.test", planType: "plus", fedRamp: false });
    expect(JSON.stringify(snapshot)).not.toContain("never-export");
    await writeFile(path.join(home, "auth.json"), JSON.stringify({ tokens: { access_token: "secret", account_id: "acct-1", fedramp: true } }));
    expect((await new CredentialReader().read(home)).fedRamp).toBe(true);
  });

  it("replaces authentication while preserving application headers", () => {
    const headers = buildUpstreamHeaders({ authorization: "Bearer client", cookie: "bad", connection: "keep-alive", "x-openai-fedramp": "true", "openai-beta": "responses=v1", "x-codex-test": "yes" }, { accessToken: "server", accountId: "acct", fedRamp: false, email: null, planType: null, loadedAt: 0 }, 12);
    expect(headers).toMatchObject({ authorization: "Bearer server", "chatgpt-account-id": "acct", "openai-beta": "responses=v1", "x-codex-test": "yes", "content-length": "12" });
    expect(headers).not.toHaveProperty("cookie");
    expect(headers).not.toHaveProperty("connection");
    expect(headers).not.toHaveProperty("x-openai-fedramp");
  });

  it("keeps data-plane payload bytes untouched", () => {
    const raw = Buffer.from('{ "client_metadata": { "thread_id": "t-1" }, "future_item": [1, 2] }');
    expect(raw.toString()).toBe('{ "client_metadata": { "thread_id": "t-1" }, "future_item": [1, 2] }');
  });

  it("routes every request to the current active account, stores no credential columns and persists active account", async () => {
    const root = await tempDir();
    await mkdir(path.join(root, "accounts", "a", "codex-home"), { recursive: true });
    await mkdir(path.join(root, "accounts", "b", "codex-home"), { recursive: true });
    const database = new GatewayDatabase(path.join(root, "gateway.db"));
    const activeAccounts = new ActiveAccountService(database);
    database.accounts.insert({ id: "a", codexHome: path.join(root, "accounts", "a", "codex-home") });
    database.accounts.insert({ id: "b", codexHome: path.join(root, "accounts", "b", "codex-home") });
    database.accounts.update("a", { authStatus: "ready" });
    database.accounts.update("b", { authStatus: "ready" });
    activeAccounts.select("a");
    expect(activeAccounts.get()!.id).toBe("a");
    activeAccounts.select("b");
    expect(activeAccounts.get()!.id).toBe("b");
    const columns = database.raw.prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
    expect(columns.map((column) => column.name)).not.toEqual(expect.arrayContaining(["access_token", "refresh_token", "id_token", "password", "browser_cookie"]));
    const accounts = new AccountService({ accountsDir: path.join(root, "accounts") } as never, database);
    await accounts.remove("a");
    expect(database.accounts.get("a")).toBeNull();
    database.close();
  });

  it("rejects requests without a manually selected active account", async () => {
    const root = await tempDir();
    const database = new GatewayDatabase(path.join(root, "gateway.db"));
    database.accounts.insert({ id: "a", codexHome: path.join(root, "a") });
    database.accounts.update("a", { authStatus: "ready" });
    const activeAccounts = new ActiveAccountService(database);
    expect(activeAccounts.get()).toBeNull();
    database.close();
  });

  it("clears active account on disable and remove without replacement", async () => {
    const root = await tempDir();
    await mkdir(path.join(root, "accounts", "a", "codex-home"), { recursive: true });
    await mkdir(path.join(root, "accounts", "b", "codex-home"), { recursive: true });
    const database = new GatewayDatabase(path.join(root, "gateway.db"));
    const activeAccounts = new ActiveAccountService(database);
    const accounts = new AccountService({ accountsDir: path.join(root, "accounts") } as never, database);
    database.accounts.insert({ id: "a", codexHome: path.join(root, "accounts", "a", "codex-home") });
    database.accounts.insert({ id: "b", codexHome: path.join(root, "accounts", "b", "codex-home") });
    database.accounts.update("a", { authStatus: "ready" });
    database.accounts.update("b", { authStatus: "ready" });
    activeAccounts.select("a");
    accounts.setEnabled("a", false);
    expect(activeAccounts.get()).toBeNull();
    activeAccounts.select("b");
    await accounts.remove("b");
    expect(activeAccounts.get()).toBeNull();
    database.close();
  });

  it("parses rate limit responses in both case conventions", () => {
    const camel = parseRateLimitResponse({ rateLimits: { primary: { usedPercent: 63, resetsAt: 1, windowDurationMins: 300 }, secondary: null }, rateLimitReachedType: "unlimited" });
    expect(camel.primary).toMatchObject({ usedPercent: 63, resetsAt: 1000, windowDurationMins: 300 });
    expect(camel.secondary).toBeNull();
    expect(camel.rateLimitReachedType).toBe("unlimited");
    const snake = parseRateLimitResponse({ rate_limits: { primary: { used_percent: 10, resets_at: 2, window_duration_mins: 60 }, secondary: { used_percent: 5 } } });
    expect(snake.primary).toMatchObject({ usedPercent: 10, resetsAt: 2000, windowDurationMins: 60 });
    expect(snake.secondary).toMatchObject({ usedPercent: 5 });
  });
});

describe("database migration v2", () => {
  it("upgrades a legacy v1 database with an existing row", async () => {
    const root = await tempDir();
    const dbPath = path.join(root, "legacy.db");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO schema_migrations(version, applied_at) VALUES (1, ${Date.now()});
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, email TEXT, plan_type TEXT,
        codex_home TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0, auth_status TEXT NOT NULL,
        fedramp INTEGER NOT NULL DEFAULT 0,
        primary_used_percent REAL, primary_resets_at INTEGER, primary_window_minutes INTEGER,
        secondary_used_percent REAL, secondary_resets_at INTEGER, secondary_window_minutes INTEGER,
        last_auth_refresh_at INTEGER, last_limits_refresh_at INTEGER, last_used_at INTEGER,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_bindings (
        routing_key TEXT PRIMARY KEY, account_id TEXT NOT NULL, thread_id TEXT, session_id TEXT,
        transport TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL, expires_at INTEGER
      );
      INSERT INTO accounts(id, label, codex_home, enabled, is_default, auth_status, fedramp, created_at, updated_at)
      VALUES ('legacy-1', 'Old label', '${path.join(root, "legacy-home").replace(/\\/g, "\\\\")}', 1, 1, 'ready', 0, ${Date.now()}, ${Date.now()});
    `);
    legacy.close();

    const database = new GatewayDatabase(dbPath);
    const account = database.accounts.get("legacy-1")!;
    expect(account).toBeTruthy();
    expect(account.chatgptAccountId).toBeNull();
    expect(database.getActiveAccountId()).toBeNull();
    expect(database.settings.get().requestMetadataLogging).toBe(true);
    const tables = database.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map((row) => row.name)).not.toContain("session_bindings");
    database.accounts.update("legacy-1", { chatgptAccountId: "acct-upgraded", authStatus: "ready" });
    expect(database.accounts.get("legacy-1")!.chatgptAccountId).toBe("acct-upgraded");
    database.setActiveAccountId("legacy-1");
    expect(database.getActiveAccountId()).toBe("legacy-1");
    database.close();
  });
});

describe("schema v4 diagnostics", () => {
  it("migrates historical reset seconds while preserving millisecond timestamps", async () => {
    const root = await tempDir();
    const dbPath = path.join(root, "timestamps.db");
    const database = new GatewayDatabase(dbPath);
    database.accounts.insert({ id: "seconds", codexHome: path.join(root, "seconds") });
    database.accounts.insert({ id: "milliseconds", codexHome: path.join(root, "milliseconds") });
    database.raw.prepare("UPDATE accounts SET primary_resets_at = ?, secondary_resets_at = ? WHERE id = ?").run(1_786_000_000, null, "seconds");
    database.raw.prepare("UPDATE accounts SET primary_resets_at = ? WHERE id = ?").run(1_786_000_000_000, "milliseconds");
    database.raw.prepare("DELETE FROM schema_migrations WHERE version = 4").run();
    database.close();

    const migrated = new GatewayDatabase(dbPath);
    expect(migrated.accounts.get("seconds")?.primaryResetsAt).toBe(1_786_000_000_000);
    expect(migrated.accounts.get("seconds")?.secondaryResetsAt).toBeNull();
    expect(migrated.accounts.get("milliseconds")?.primaryResetsAt).toBe(1_786_000_000_000);
    migrated.close();
  });

  it("filters and summarizes structured request logs without request bodies", async () => {
    const root = await tempDir();
    const database = new GatewayDatabase(path.join(root, "logs.db"));
    database.requestLog.log({ requestId: "req-ok", route: "/responses", transport: "http", statusCode: 200, durationMs: 20, bytesIn: 10, bytesOut: 30 });
    database.requestLog.log({ requestId: "req-failed", route: "/responses", transport: "http", statusCode: 500, durationMs: 80, errorCode: "upstream_error" });
    const result = database.requestLog.query({ since: 0, status: "error", limit: 50 });
    expect(result.summary).toEqual({ requests: 1, errors: 1, averageDurationMs: 80 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ requestId: "req-failed", errorCode: "upstream_error" });
    expect(JSON.stringify(result)).not.toContain("body");
    database.close();
  });

  it("persists supported logger levels and rejects invalid values", async () => {
    const root = await tempDir();
    const database = new GatewayDatabase(path.join(root, "settings.db"));
    expect(database.settings.update({ logLevel: "warn" }).logLevel).toBe("warn");
    expect(() => database.settings.update({ logLevel: "trace" })).toThrow("invalid_setting");
    expect(database.settings.get().logLevel).toBe("warn");
    database.close();
  });
});

describe("Codex app-server adapter", () => {  it("uses isolated CODEX_HOME and JSON-RPC account methods", async () => {
    const home = await tempDir();
    await mkdir(home, { recursive: true });
    const script = path.resolve("test/fake-app-server.mjs");
    const client = new AppServerClient(process.execPath, home, [script]);
    await client.start();
    expect(await client.call("account/login/start", { type: "chatgpt" })).toMatchObject({ loginId: "login-1", authUrl: expect.stringContaining("openai.test") });
    expect(await client.call("account/rateLimits/read", {})).toMatchObject({ rateLimits: { primary: { usedPercent: 25 } } });
    expect(client.codexHome).toBe(home);
    await client.close();
  });

  it("handshakes with the pinned official Codex app-server", async () => {
    const home = await tempDir();
    await writeFile(path.join(home, "config.toml"), 'cli_auth_credentials_store = "file"\n');
    const config = loadConfig({ dataDir: home, developerMode: true });
    const client = new AppServerClient(config.codexCliPath, home, config.codexCliArgs);
    await client.start();
    expect(await client.call("account/read", { refreshToken: false })).toMatchObject({ requiresOpenaiAuth: true });
    await client.close();
  });

  it("completes isolated browser-login metadata, limits and official refresh flow", async () => {
    const root = await tempDir();
    const config = loadConfig({
      dataDir: path.join(root, "data"),
      accountsDir: path.join(root, "data", "accounts"),
      loginStagingDir: path.join(root, "data", "login-staging"),
      databasePath: path.join(root, "data", "gateway.db"),
      codexCliPath: process.execPath,
      codexCliArgs: [path.resolve("test/fake-app-server.mjs")],
      developerMode: true,
    });
    const database = new GatewayDatabase(config.databasePath);
    const logins = new AccountLoginService(config, database);
    const login = await logins.start();
    expect(login.authUrl).toMatch(/^https:\/\/auth\.openai\.test/);
    expect(login.status).toBe("waiting");
    const completed = await logins.getStatus(login.loginId);
    expect(completed.status).toBe("complete");
    const accountId = completed.createdAccountId ?? database.accounts.list()[0].id;
    const account = database.accounts.get(accountId)!;
    expect(account).toMatchObject({ authStatus: "ready", email: "owner@example.test", planType: "plus", chatgptAccountId: "isolated-account", primaryUsedPercent: 25, secondaryUsedPercent: 10 });
    expect(account.codexHome).toContain(path.join("data", "accounts", accountId, "codex-home"));
    const auth = new AccountAuthService(config, database);
    const usage = new AccountUsageService(config, database);
    await auth.refresh(accountId);
    const rpcLog = await readFile(path.join(account.codexHome, "rpc.log"), "utf8");
    expect(rpcLog).toContain('"method":"account/read","params":{"refreshToken":true}');
    await usage.refresh(accountId);
    expect(JSON.stringify(database.accounts.list())).not.toContain("isolated-access");
    await logins.close();
    database.close();
  });

  it("completes only once when login completion is triggered concurrently", async () => {
    const root = await tempDir();
    const config = loadConfig({
      dataDir: path.join(root, "data"),
      accountsDir: path.join(root, "data", "accounts"),
      loginStagingDir: path.join(root, "data", "login-staging"),
      databasePath: path.join(root, "data", "gateway.db"),
      codexCliPath: process.execPath,
      codexCliArgs: [path.resolve("test/fake-app-server.mjs")],
      developerMode: true,
    });
    const database = new GatewayDatabase(config.databasePath);
    const logins = new AccountLoginService(config, database);
    const login = await logins.start();
    const [first, second, third] = await Promise.all([
      logins.getStatus(login.loginId),
      logins.getStatus(login.loginId),
      logins.getStatus(login.loginId),
    ]);
    expect(first.status).toBe("complete");
    expect(second.status).toBe("complete");
    expect(third.status).toBe("complete");
    const accounts = database.accounts.list();
    expect(accounts).toHaveLength(1);
    expect(accounts[0].chatgptAccountId).toBe("isolated-account");
    const accountRoot = path.join(root, "data", "accounts", accounts[0].id);
    expect(await pathExists(accountRoot)).toBe(true);
    await logins.close();
    database.close();
  });

  it("completes login when a grandchild still holds the staging directory", async () => {
    const previousLockMs = process.env.CODEX_FAKE_LOCK_MS;
    process.env.CODEX_FAKE_LOCK_MS = "1500";
    try {
      const root = await tempDir();
      const config = loadConfig({
        dataDir: path.join(root, "data"),
        accountsDir: path.join(root, "data", "accounts"),
        loginStagingDir: path.join(root, "data", "login-staging"),
        databasePath: path.join(root, "data", "gateway.db"),
        codexCliPath: process.execPath,
        codexCliArgs: [path.resolve("test/fake-app-server-locked.mjs")],
        developerMode: true,
      });
      const database = new GatewayDatabase(config.databasePath);
      const logins = new AccountLoginService(config, database);
      const login = await logins.start();
      const completed = await logins.getStatus(login.loginId);
      expect(completed.status).toBe("complete");
      const accounts = database.accounts.list();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].chatgptAccountId).toBe("isolated-account");
      const accountRoot = path.join(root, "data", "accounts", accounts[0].id);
      expect(await pathExists(path.join(accountRoot, "codex-home", "auth.json"))).toBe(true);
      const stagingRoot = path.join(root, "data", "login-staging", accounts[0].id);
      for (let attempt = 0; attempt < 40; attempt++) {
        if (!(await pathExists(stagingRoot))) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(await pathExists(stagingRoot)).toBe(false);
      await logins.close();
      database.close();
    } finally {
      if (previousLockMs === undefined) delete process.env.CODEX_FAKE_LOCK_MS;
      else process.env.CODEX_FAKE_LOCK_MS = previousLockMs;
    }
  });

  it("rejects a duplicate chatgpt account id on a second login", async () => {
    const root = await tempDir();
    const config = loadConfig({
      dataDir: path.join(root, "data"),
      accountsDir: path.join(root, "data", "accounts"),
      loginStagingDir: path.join(root, "data", "login-staging"),
      databasePath: path.join(root, "data", "gateway.db"),
      codexCliPath: process.execPath,
      codexCliArgs: [path.resolve("test/fake-app-server.mjs")],
      developerMode: true,
    });
    const database = new GatewayDatabase(config.databasePath);
    const logins = new AccountLoginService(config, database);
    const first = await logins.start();
    await logins.getStatus(first.loginId);
    const second = await logins.start();
    await logins.getStatus(second.loginId);
    const accountId = database.accounts.list()[0].id;
    expect(database.accounts.get(accountId)!.chatgptAccountId).toBe("isolated-account");
    const secondAccount = database.accounts.list().find((item) => item.id !== accountId);
    expect(secondAccount).toBeUndefined();
    await logins.close();
    database.close();
  });
});
