import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGateway, type GatewayApp } from "../src/app.js";

let root: string;
let gateway: GatewayApp;

async function csrfHeaders(): Promise<Record<string, string>> {
  const health = await gateway.app.inject({ method: "GET", url: "/api/health" });
  const token = health.json().csrfToken as string;
  const cookie = String(health.headers["set-cookie"]).split(";")[0];
  return { "x-csrf-token": token, cookie, origin: "http://localhost:80" };
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "warmup-api-"));
  gateway = await buildGateway(
    {
      host: "127.0.0.1",
      port: 0,
      upstreamBaseUrl: "http://127.0.0.1:1/backend-api/codex",
      dataDir: path.join(root, "data"),
      accountsDir: path.join(root, "data", "accounts"),
      databasePath: path.join(root, "data", "gateway.db"),
      codexCliPath: process.execPath,
      codexCliArgs: [path.resolve("test/fake-app-server.mjs")],
      developerMode: true,
    },
    { backgroundTasks: false },
  );
  for (const id of ["first", "second"]) {
    const home = path.join(root, id);
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, "auth.json"), JSON.stringify({ tokens: { access_token: "a", account_id: id, refresh_token: "r" } }));
    gateway.database.accounts.insert({ id, codexHome: home });
    gateway.database.accounts.update(id, { chatgptAccountId: id, authStatus: "ready" });
  }
});

afterAll(async () => {
  await gateway.app.close();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("warm-up API", () => {
  it("starts with the automatic pass off, so an upgrade spends nobody's quota", async () => {
    const body = (await gateway.app.inject({ method: "GET", url: "/api/warmup" })).json();
    expect(body.settings.auto).toBe(false);
    expect(body.settings.message).toBeTruthy();
    expect(body.progress).toMatchObject({ running: false });
    expect(body.recent).toEqual([]);
  });

  it("says of every account whether its short window is still counting", async () => {
    gateway.database.accounts.updateRateLimits("first", {
      primary: { usedPercent: 0, resetsAt: Date.now() + 3_600_000, windowDurationMins: 300 },
      secondary: null, credits: null, individualLimit: null, spendControlReached: null,
      resetCredits: null, buckets: [], defaultBucketKey: null,
    });
    const body = (await gateway.app.inject({ method: "GET", url: "/api/warmup" })).json();
    const first = body.accounts.find((account: { id: string }) => account.id === "first");
    const second = body.accounts.find((account: { id: string }) => account.id === "second");
    // The console needs this to say "预热 1 个账号" rather than offering to
    // spend on a window that is already running.
    expect(first).toMatchObject({ enrolled: true, eligible: true, windowRunning: true });
    expect(second).toMatchObject({ enrolled: true, eligible: true, windowRunning: false });
  });

  it("refuses a write without the CSRF proof", async () => {
    const response = await gateway.app.inject({
      method: "PATCH", url: "/api/warmup", payload: { auto: true },
    });
    expect(response.statusCode).toBe(403);
  });

  it("takes a blank message as the default rather than an empty turn", async () => {
    const response = await gateway.app.inject({
      method: "PATCH", url: "/api/warmup", headers: await csrfHeaders(), payload: { message: "   " },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().message).toBe("回复 OK 即可，不要解释。");
  });

  it("rejects a daily ceiling nobody could have meant", async () => {
    const response = await gateway.app.inject({
      method: "PATCH", url: "/api/warmup", headers: await csrfHeaders(), payload: { dailyLimit: 0 },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("invalid_setting");
  });

  it("takes an account out of the rotation", async () => {
    const response = await gateway.app.inject({
      method: "PATCH", url: "/api/warmup/enrollment", headers: await csrfHeaders(),
      payload: { enrolled: { second: false } },
    });
    expect(response.statusCode).toBe(200);
    expect(gateway.database.accounts.get("second")?.warmupEnrolled).toBe(false);
    gateway.database.accounts.update("second", { warmupEnrolled: true });
  });

  it("refuses enrolment for an account that does not exist", async () => {
    const response = await gateway.app.inject({
      method: "PATCH", url: "/api/warmup/enrollment", headers: await csrfHeaders(),
      payload: { enrolled: { nobody: true } },
    });
    expect(response.statusCode).toBe(404);
  });

  it("answers the run before it finishes, and says how many it will attempt", async () => {
    const response = await gateway.app.inject({
      method: "POST", url: "/api/warmup/run", headers: await csrfHeaders(), payload: {},
    });
    // A turn per account is tens of seconds; the console follows progress on
    // the event stream rather than holding a request open for it.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ started: true, total: 1 });
  });
  it("says which accounts have spent their week, and when it turns over", async () => {
    const weekEnds = Date.now() + 3 * 86_400_000;
    gateway.database.accounts.updateRateLimits("first", {
      primary: { usedPercent: 0, resetsAt: null, windowDurationMins: 300 },
      secondary: { usedPercent: 100, resetsAt: weekEnds, windowDurationMins: 10080 },
      credits: null, individualLimit: null, spendControlReached: null,
      resetCredits: null, buckets: [], defaultBucketKey: null,
    });
    const body = (await gateway.app.inject({ method: "GET", url: "/api/warmup" })).json();
    const first = body.accounts.find((account: { id: string }) => account.id === "first");
    // Kept apart from `eligible`: the account is fine, its week is just gone.
    expect(first).toMatchObject({ eligible: true, weeklyExhausted: true, weeklyResetsAt: weekEnds });
  });
});
