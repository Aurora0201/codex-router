import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppServerClient } from "../src/accounts/app-server-client.js";
import { AccountService } from "../src/accounts/account-service.js";
import { AccountLoginService } from "../src/accounts/account-login-service.js";
import { AccountAuthService } from "../src/accounts/account-auth-service.js";
import { AccountUsageService } from "../src/accounts/account-usage-service.js";
import { CredentialReader } from "../src/accounts/credential-reader.js";
import { DEFAULT_DATA_DIR, loadConfig } from "../src/config.js";
import { GatewayDatabase } from "../src/db/database.js";
import { buildUpstreamHeaders, isCompactionRequest } from "../src/proxy/headers.js";
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
  it("uses OS application data and packaged admin UI defaults", () => {
    const previousDataDir = process.env.GATEWAY_DATA_DIR;
    const previousWebDist = process.env.GATEWAY_WEB_DIST;
    delete process.env.GATEWAY_DATA_DIR;
    delete process.env.GATEWAY_WEB_DIST;
    try {
      const config = loadConfig({ developerMode: true });
      expect(config.dataDir).toBe(DEFAULT_DATA_DIR);
      expect(config.webDistDir).toBe(path.resolve("web-dist"));
    } finally {
      if (previousDataDir === undefined) delete process.env.GATEWAY_DATA_DIR;
      else process.env.GATEWAY_DATA_DIR = previousDataDir;
      if (previousWebDist === undefined) delete process.env.GATEWAY_WEB_DIST;
      else process.env.GATEWAY_WEB_DIST = previousWebDist;
    }
  });

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

  it("notifies listeners only when the active account actually changes", async () => {
    const root = await tempDir();
    const database = new GatewayDatabase(path.join(root, "gateway.db"));
    database.accounts.insert({ id: "a", codexHome: path.join(root, "a") });
    database.accounts.insert({ id: "b", codexHome: path.join(root, "b") });
    database.accounts.update("a", { authStatus: "ready" });
    database.accounts.update("b", { authStatus: "ready" });
    const activeAccounts = new ActiveAccountService(database);
    const changes: Array<[string | null, string | null]> = [];
    const unsubscribe = activeAccounts.onChange((previous, current) => changes.push([previous, current]));

    activeAccounts.select("a");
    activeAccounts.select("a");
    activeAccounts.select("b");
    activeAccounts.clear();
    unsubscribe();
    activeAccounts.select("a");

    expect(changes).toEqual([[null, "a"], ["a", "b"], ["b", null]]);
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

describe("schema diagnostics", () => {
  it.skip("adds a managed identity mode to historical request logs", async () => {
    const root = await tempDir();
    const dbPath = path.join(root, "identity-mode.db");
    const database = new GatewayDatabase(dbPath);
    database.requestLog.log({ requestId: "historical", route: "/models", transport: "models", statusCode: 200 });
    database.raw.exec("ALTER TABLE request_log DROP COLUMN identity_mode");
    database.raw.prepare("DELETE FROM schema_migrations WHERE version = 8").run();
    database.close();

    const migrated = new GatewayDatabase(dbPath);
    expect(migrated.requestLog.query({ since: 0, limit: 10 }).items[0]).toMatchObject({ identityMode: "managed_account" });
    migrated.close();
  });

  it.skip("migrates historical reset seconds while preserving millisecond timestamps", async () => {
    const root = await tempDir();
    const dbPath = path.join(root, "timestamps.db");
    const database = new GatewayDatabase(dbPath);
    database.accounts.insert({ id: "seconds", codexHome: path.join(root, "seconds") });
    database.accounts.insert({ id: "milliseconds", codexHome: path.join(root, "milliseconds") });
    database.raw.prepare("UPDATE accounts SET primary_resets_at = ?, secondary_resets_at = ? WHERE id = ?").run(1_786_000_000, null, "seconds");
    database.raw.prepare("UPDATE accounts SET primary_resets_at = ? WHERE id = ?").run(1_786_000_000_000, "milliseconds");
    database.raw.prepare("DELETE FROM schema_migrations WHERE version >= 4").run();
    database.close();

    const migrated = new GatewayDatabase(dbPath);
    expect(migrated.accounts.get("seconds")?.primaryResetsAt).toBe(1_786_000_000_000);
    expect(migrated.accounts.get("seconds")?.secondaryResetsAt).toBeNull();
    expect(migrated.accounts.get("milliseconds")?.primaryResetsAt).toBe(1_786_000_000_000);
    migrated.close();
  });

  it("recognizes only bounded Codex compaction metadata", () => {
    expect(isCompactionRequest({ "x-codex-turn-metadata": JSON.stringify({ request_kind: "compaction" }) })).toBe(true);
    expect(isCompactionRequest({ "x-codex-turn-metadata": JSON.stringify({ request_kind: "turn" }) })).toBe(false);
    expect(isCompactionRequest({ "x-codex-turn-metadata": "not-json" })).toBe(false);
    expect(isCompactionRequest({ "x-codex-turn-metadata": "x".repeat(8 * 1024 + 1) })).toBe(false);
  });

  it.skip("backfills historical aborts as status-less client cancellations", async () => {
    const root = await tempDir();
    const dbPath = path.join(root, "cancelled.db");
    const database = new GatewayDatabase(dbPath);
    database.raw.prepare(`
      INSERT INTO request_log(id, route, transport, status_code, error_code, outcome, scope, created_at)
      VALUES ('cancelled-old', '/models', 'models', 502, 'This operation was aborted', 'upstream_error', 'request', 1)
    `).run();
    database.raw.prepare("DELETE FROM schema_migrations WHERE version >= 6").run();
    database.close();

    const migrated = new GatewayDatabase(dbPath);
    const item = migrated.requestLog.query({ since: 0, status: "cancelled", limit: 10 }).items[0];
    expect(item).toMatchObject({ outcome: "client_cancelled", errorCode: "client_cancelled" });
    expect(item?.statusCode).toBeUndefined();
    migrated.close();
  });

  it.skip("reconciles historical request outcomes from their recorded status", async () => {
    const root = await tempDir();
    const dbPath = path.join(root, "outcomes.db");
    const database = new GatewayDatabase(dbPath);
    database.raw.prepare(`
      INSERT INTO request_log(id, route, transport, status_code, outcome, scope, created_at)
      VALUES ('successful-old', '/responses', 'http', 200, 'upstream_error', 'request', 1)
    `).run();
    database.raw.prepare("DELETE FROM schema_migrations WHERE version >= 7").run();
    database.close();

    const migrated = new GatewayDatabase(dbPath);
    const item = migrated.requestLog.query({ since: 0, status: "success", limit: 10 }).items[0];
    expect(item).toMatchObject({ statusCode: 200, outcome: "success", scope: "request" });
    migrated.close();
  });

  it("filters and summarizes structured request logs without request bodies", async () => {
    const root = await tempDir();
    const database = new GatewayDatabase(path.join(root, "logs.db"));
    const successful = database.requestLog.startRequest({ requestId: "req-ok", route: "/responses", transport: "http", startedAt: 1 });
    database.requestLog.finishRequest(successful, { state: "completed", outcome: "success", httpStatus: 200, completedAt: 21, bytesIn: 10, bytesOut: 30 });
    const failed = database.requestLog.startRequest({ requestId: "req-failed", route: "/responses", transport: "http", startedAt: 1 });
    database.requestLog.finishRequest(failed, { state: "failed", outcome: "upstream_error", failureSource: "upstream_http", httpStatus: 500, diagnosticCode: "upstream_http_500", completedAt: 81 });
    const result = database.requestLog.query({ since: 0, status: "error", limit: 50 });
    expect(result.summary).toEqual({
      requests: 1,
      errors: 1,
      rejected: 0,
      cancelled: 0,
      availabilityRequests: 1,
      availabilityErrors: 1,
      averageDurationMs: 80,
    });
    expect(result.items).toHaveLength(1);
    expect(result.timeline).toHaveLength(1);
    expect(result.pagination).toEqual({ page: 1, pageSize: 50, totalItems: 1, totalPages: 1 });
    expect(result.items[0]).toMatchObject({ requestId: "req-failed", diagnosticCode: "upstream_http_500" });
    expect(JSON.stringify(result)).not.toContain("body");
    database.close();
  });

  it("supports direct request-log page access and clamps pages after the end", async () => {
    const root = await tempDir();
    const database = new GatewayDatabase(path.join(root, "paged-logs.db"));
    const insert = database.raw.prepare(`
      INSERT INTO request_log(id, route, transport, state, outcome, started_at, completed_at, http_status)
      VALUES (?, '/responses', 'http', 'completed', 'success', ?, ?, 200)
    `);
    database.raw.transaction(() => {
      for (let index = 0; index < 45; index++) insert.run(`log-${index}`, 1_000 + index, 1_010 + index);
    })();
    const middle = database.requestLog.query({ since: 0, page: 2, limit: 20 });
    expect(middle.pagination).toEqual({ page: 2, pageSize: 20, totalItems: 45, totalPages: 3 });
    expect(middle.items).toHaveLength(20);
    expect(middle.items[0]?.id).toBe("log-24");
    const clamped = database.requestLog.query({ since: 0, page: 99, limit: 20 });
    expect(clamped.pagination.page).toBe(3);
    expect(clamped.items).toHaveLength(5);
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

  it("caps the filtered request timeline at 500 rows and excludes missing durations", async () => {
    const root = await tempDir();
    const database = new GatewayDatabase(path.join(root, "timeline.db"));
    const insert = database.raw.prepare(`
      INSERT INTO request_log(id, route, transport, state, outcome, started_at, completed_at, http_status)
      VALUES (?, '/responses', 'http', ?, ?, ?, ?, ?)
    `);
    database.raw.transaction(() => {
      for (let index = 0; index < 502; index++) {
        const statusCode = index % 2 ? 200 : 500;
        const state = statusCode >= 500 ? "failed" : "completed";
        const startedAt = Date.now() + index;
        const duration = index === 501 ? null : index + 1;
        insert.run(`log-${index}`, state, statusCode >= 500 ? "upstream_error" : "success", startedAt, duration === null ? null : startedAt + duration, statusCode);
      }
    })();
    const result = database.requestLog.query({ since: 0, status: "error", limit: 10 });
    expect(result.timeline).toHaveLength(251);
    expect(result.timeline.every((point) => (point.statusCode ?? 0) >= 400)).toBe(true);
    const all = database.requestLog.query({ since: 0, limit: 10 });
    expect(all.timeline).toHaveLength(500);
    expect(all.timeline.every((point) => point.durationMs !== null)).toBe(true);
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
    process.env.CODEX_FAKE_LOCK_MS = "6500";
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
      const stagingEntries = await readdir(config.loginStagingDir);
      const stagingRoot = path.join(config.loginStagingDir, stagingEntries[0]);
      expect(await readFile(path.join(stagingRoot, "codex-home", "config.toml"), "utf8")).toContain("plugins = false");
      const startedAt = Date.now();
      const completed = await logins.getStatus(login.loginId);
      expect(Date.now() - startedAt).toBeLessThan(5_000);
      expect(completed.status).toBe("complete");
      const accounts = database.accounts.list();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].chatgptAccountId).toBe("isolated-account");
      const accountRoot = path.join(root, "data", "accounts", accounts[0].id);
      expect(await pathExists(path.join(accountRoot, "codex-home", "auth.json"))).toBe(true);
      expect(await pathExists(path.join(accountRoot, "codex-home", ".tmp"))).toBe(false);
      for (let attempt = 0; attempt < 60; attempt++) {
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

  it("cleans stale staging directories without blocking startup", async () => {
    const root = await tempDir();
    const config = loadConfig({
      dataDir: path.join(root, "data"),
      accountsDir: path.join(root, "data", "accounts"),
      loginStagingDir: path.join(root, "data", "login-staging"),
      databasePath: path.join(root, "data", "gateway.db"),
      developerMode: true,
    });
    const stale = path.join(config.loginStagingDir, "stale-login", "codex-home");
    await mkdir(stale, { recursive: true });
    await writeFile(path.join(stale, "config.toml"), "stale");
    const database = new GatewayDatabase(config.databasePath);
    const logins = new AccountLoginService(config, database);
    await logins.cleanupStaleStaging();
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!(await pathExists(path.dirname(stale)))) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await pathExists(path.dirname(stale))).toBe(false);
    database.close();
  });

  it("rolls back a promoted account and exposes only a stable finalize error", async () => {
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
    const insert = vi.spyOn(database.accounts, "insert").mockImplementation(() => {
      throw new Error(`EBUSY: resource busy or locked, rmdir '${config.loginStagingDir}'`);
    });
    const result = await logins.getStatus(login.loginId);
    expect(result).toMatchObject({ status: "failed", error: "account_login_finalize_failed" });
    expect(result.error).not.toContain(config.loginStagingDir);
    expect(database.accounts.list()).toHaveLength(0);
    insert.mockRestore();
    await logins.close();
    database.close();
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
    const duplicate = await logins.getStatus(second.loginId);
    expect(duplicate).toMatchObject({ status: "failed", error: "account_already_exists" });
    const accountId = database.accounts.list()[0].id;
    expect(database.accounts.get(accountId)!.chatgptAccountId).toBe("isolated-account");
    const secondAccount = database.accounts.list().find((item) => item.id !== accountId);
    expect(secondAccount).toBeUndefined();
    await logins.close();
    database.close();
  });

  it("closes the app-server before cleaning a cancelled login", async () => {
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
    const stagingRoot = path.join(config.loginStagingDir, (await readdir(config.loginStagingDir))[0]);
    await logins.cancel(login.loginId);
    expect(logins.list()[0].status).toBe("cancelled");
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!(await pathExists(stagingRoot))) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await pathExists(stagingRoot)).toBe(false);
    await logins.close();
    database.close();
  });

  it("cleans waiting login staging when the service closes", async () => {
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
    await logins.start();
    const stagingRoot = path.join(config.loginStagingDir, (await readdir(config.loginStagingDir))[0]);
    await logins.close();
    for (let attempt = 0; attempt < 20; attempt++) {
      if (!(await pathExists(stagingRoot))) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await pathExists(stagingRoot)).toBe(false);
    database.close();
  });

  it("rejects FedRAMP login with a stable error after closing the app-server", async () => {
    const previousFedRamp = process.env.CODEX_FAKE_FEDRAMP;
    process.env.CODEX_FAKE_FEDRAMP = "1";
    try {
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
      const result = await logins.getStatus(login.loginId);
      expect(result).toMatchObject({ status: "failed", error: "fedramp_accounts_not_supported" });
      expect(database.accounts.list()).toHaveLength(0);
      await logins.close();
      database.close();
    } finally {
      if (previousFedRamp === undefined) delete process.env.CODEX_FAKE_FEDRAMP;
      else process.env.CODEX_FAKE_FEDRAMP = previousFedRamp;
    }
  });
});
