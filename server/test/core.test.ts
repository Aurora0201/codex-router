import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppServerClient } from "../src/accounts/app-server-client.js";
import { AccountService } from "../src/accounts/account-service.js";
import { CredentialReader } from "../src/accounts/credential-reader.js";
import { loadConfig } from "../src/config.js";
import { GatewayDatabase } from "../src/db/database.js";
import { buildUpstreamHeaders } from "../src/proxy/headers.js";
import { resolveSession } from "../src/routing/session-resolver.js";

const temporary: string[] = [];
async function tempDir() { const dir = await mkdtemp(path.join(os.tmpdir(), "codex-gateway-test-")); temporary.push(dir); return dir; }
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

  it("inspects routing metadata without changing raw payload bytes", () => {
    const raw = Buffer.from('{ "client_metadata": { "thread_id": "t-1" }, "future_item": [1, 2] }');
    expect(resolveSession({}, raw).routingKey).toBe("thread:t-1");
    expect(raw.toString()).toBe('{ "client_metadata": { "thread_id": "t-1" }, "future_item": [1, 2] }');
  });

  it("keeps bindings sticky and stores no credential columns", async () => {
    const root = await tempDir();
    const database = new GatewayDatabase(path.join(root, "gateway.db"));
    const a = database.createAccount({ id: "a", label: "A", codexHome: path.join(root, "a") });
    const b = database.createAccount({ id: "b", label: "B", codexHome: path.join(root, "b") });
    database.updateAccount("a", { authStatus: "ready" });
    database.updateAccount("b", { authStatus: "ready" });
    database.setDefaultAccount("a");
    const identity = resolveSession({ "thread-id": "sticky" }, null);
    expect(database.resolveBinding(identity, "http", a).id).toBe("a");
    database.setDefaultAccount("b");
    expect(database.resolveBinding(identity, "compact", b).id).toBe("a");
    database.updateAccount("b", { enabled: false, authStatus: "disabled" });
    expect(database.getDefaultAccount()?.id).toBe("a");
    const columns = database.raw.prepare("PRAGMA table_info(accounts)").all() as { name: string }[];
    expect(columns.map((column) => column.name)).not.toEqual(expect.arrayContaining(["access_token", "refresh_token", "id_token", "password", "browser_cookie"]));
    database.releaseSession(identity.routingKey);
    database.deleteAccount("a");
    expect(database.getAccount("a")).toBeNull();
    database.close();
  });
});

describe("Codex app-server adapter", () => {
  it("uses isolated CODEX_HOME and JSON-RPC account methods", async () => {
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
      databasePath: path.join(root, "data", "gateway.db"),
      codexCliPath: process.execPath,
      codexCliArgs: [path.resolve("test/fake-app-server.mjs")],
      developerMode: true,
    });
    const database = new GatewayDatabase(config.databasePath);
    const accounts = new AccountService(config, database);
    const login = await accounts.startBrowserLogin("Personal");
    expect(login.authUrl).toMatch(/^https:\/\/auth\.openai\.test/);
    expect((await accounts.getLoginStatus(login.loginId)).status).toBe("complete");
    const account = database.getAccount(login.accountId)!;
    expect(account).toMatchObject({ authStatus: "ready", email: "owner@example.test", planType: "plus", primaryUsedPercent: 25, secondaryUsedPercent: 10 });
    expect(account.codexHome).toContain(path.join("data", "accounts", login.accountId, "codex-home"));
    await accounts.refreshAuth(login.accountId);
    const rpcLog = await readFile(path.join(account.codexHome, "rpc.log"), "utf8");
    expect(rpcLog).toContain('"method":"account/read","params":{"refreshToken":true}');
    expect(JSON.stringify(database.listAccounts())).not.toContain("isolated-access");
    await accounts.close();
    database.close();
  });
});
