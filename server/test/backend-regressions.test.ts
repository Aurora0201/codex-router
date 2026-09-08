import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountOperationLock } from "../src/accounts/account-lock.js";
import { AccountService } from "../src/accounts/account-service.js";
import { AccountStatusService } from "../src/accounts/account-status-service.js";
import { AccountLoginService } from "../src/accounts/account-login-service.js";
import { AppServerClient } from "../src/accounts/app-server-client.js";
import { ActiveAccountService } from "../src/routing/active-account-service.js";
import { GatewayDatabase } from "../src/db/database.js";
import { loadConfig } from "../src/config.js";

vi.mock(import("node:fs/promises"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, rm: vi.fn(actual.rm), cp: vi.fn(actual.cp) };
});

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "backend-regression-"));
  cleanup.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const config = loadConfig({
    dataDir: root, databasePath: path.join(root, "gateway.db"),
    accountsDir: path.join(root, "accounts"), loginStagingDir: path.join(root, "staging"),
    codexCliPath: process.execPath, codexCliArgs: [path.resolve("test/fake-app-server.mjs")], developerMode: true,
  });
  const database = new GatewayDatabase(config.databasePath);
  cleanup.push(async () => database.close());
  const lock = new AccountOperationLock();
  const status = new AccountStatusService(config, database, undefined, lock);
  cleanup.push(() => status.close());
  const active = new ActiveAccountService(database);
  const accounts = new AccountService(config, database, active, lock);
  const home = path.join(config.accountsDir, "account", "codex-home");
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "auth.json"), JSON.stringify({ tokens: { access_token: "test-access", account_id: "account-id" } }));
  database.accounts.insert({ id: "account", codexHome: home });
  database.accounts.update("account", { authStatus: "ready", chatgptAccountId: "account-id" });
  return { config, database, status, active, accounts, home };
}

function holdAccountRead() {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const original = AppServerClient.prototype.call;
  vi.spyOn(AppServerClient.prototype, "call").mockImplementation(async function (method, params, timeout) {
    if (method === "account/read") { entered.resolve(); await release.promise; }
    return original.call(this, method, params, timeout);
  });
  return { entered: entered.promise, release: release.resolve };
}

describe("backend lifecycle regressions", () => {
  it("runs a forced auth refresh after an in-flight quota read", async () => {
    const { status, home } = await fixture();
    await Promise.all([
      status.refresh("account"),
      status.refresh("account", { refreshToken: true, checking: true }),
      status.refresh("account", { refreshToken: true }),
    ]);
    const calls = (await readFile(path.join(home, "rpc.log"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(calls.filter((call) => call.method === "account/read").map((call) => call.params.refreshToken)).toEqual([false, true]);
  });

  it("retains a disabled account after a directory deletion failure so deletion can be retried", async () => {
    const { accounts, database, active } = await fixture();
    active.select("account");
    vi.mocked(rm).mockRejectedValueOnce(Object.assign(new Error("locked"), { code: "EBUSY" }));
    await expect(accounts.remove("account")).rejects.toThrow();
    expect(database.accounts.get("account")).toMatchObject({ enabled: false });
    expect(database.getActiveAccountId()).toBeNull();
    await accounts.remove("account");
    expect(database.accounts.get("account")).toBeNull();
  });

  it("waits for an active refresh before deleting credentials and blocks re-enabling during removal", async () => {
    const { status, accounts, database, home } = await fixture();
    const hold = holdAccountRead();
    const refresh = status.refresh("account");
    await hold.entered;
    const removal = accounts.remove("account");
    try {
      expect(() => accounts.setEnabled("account", true)).toThrow("account_removal_in_progress");
      expect(await readFile(path.join(home, "auth.json"), "utf8")).toContain("test-access");
      expect(database.accounts.get("account")?.enabled).toBe(false);
    } finally { hold.release(); await refresh; await removal; }
    expect(database.accounts.get("account")).toBeNull();
  });

  it("does not overwrite a completed login when cancellation arrives late", async () => {
    const { config, database } = await fixture();
    const logins = new AccountLoginService(config, database);
    cleanup.push(() => logins.close());
    const login = await logins.start();
    const completed = await logins.getStatus(login.loginId);
    await logins.cancel(login.loginId);
    expect(await logins.getStatus(login.loginId)).toEqual(completed);
  });

  it("rolls back promotion if cancellation arrives while files are being copied", async () => {
    const { config, database } = await fixture();
    const logins = new AccountLoginService(config, database);
    cleanup.push(() => logins.close());
    const login = await logins.start();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const copy = vi.mocked(cp).getMockImplementation()!;
    vi.mocked(cp).mockImplementationOnce(async (...args) => {
      await copy(...args);
      entered.resolve();
      await release.promise;
    });
    const completion = logins.getStatus(login.loginId);
    await entered.promise;
    const cancellation = logins.cancel(login.loginId);
    release.resolve();
    await Promise.all([completion, cancellation]);
    expect((await logins.getStatus(login.loginId)).status).toBe("cancelled");
    expect(await readdir(config.accountsDir)).toEqual(["account"]);
  });

  it("keeps cancellation terminal when login finalization resumes", async () => {
    const { config, database } = await fixture();
    const logins = new AccountLoginService(config, database);
    cleanup.push(() => logins.close());
    const login = await logins.start();
    const hold = holdAccountRead();
    const completion = logins.getStatus(login.loginId);
    await hold.entered;
    try {
      const cancellation = logins.cancel(login.loginId);
      hold.release();
      await cancellation;
      await completion;
      expect((await logins.getStatus(login.loginId)).status).toBe("cancelled");
      expect(database.accounts.list()).toHaveLength(1);
    } finally { hold.release(); await completion; }
  });

  it("waits for in-flight login finalization before closing", async () => {
    const { config, database } = await fixture();
    const logins = new AccountLoginService(config, database);
    const login = await logins.start();
    const hold = holdAccountRead();
    const completion = logins.getStatus(login.loginId);
    await hold.entered;
    let closed = false;
    const closing = logins.close().then(() => { closed = true; });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(closed).toBe(false);
    } finally { hold.release(); await completion; await closing; }
    expect(database.accounts.list()).toHaveLength(1);
  });

  it("clears the process-exit timeout after a graceful close", async () => {
    const { home } = await fixture();
    const client = new AppServerClient(process.execPath, home, [path.resolve("test/fake-app-server.mjs")]);
    await client.start();
    const timers = vi.spyOn(globalThis, "setTimeout");
    const clear = vi.spyOn(globalThis, "clearTimeout");
    const firstClose = client.close();
    expect(client.close()).toBe(firstClose);
    await firstClose;
    const index = timers.mock.calls.findIndex((call) => call[1] === 30_000);
    const timeout = timers.mock.results[index]?.value;
    try { expect(clear).toHaveBeenCalledWith(timeout); }
    finally { clearTimeout(timeout); }
  });
});
