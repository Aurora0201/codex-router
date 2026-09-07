import { mkdtemp, rm } from "node:fs/promises";
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
  root = await mkdtemp(path.join(os.tmpdir(), "auto-switch-api-"));
  gateway = await buildGateway(
    {
      host: "127.0.0.1",
      port: 0,
      upstreamBaseUrl: "http://127.0.0.1:1/backend-api/codex",
      dataDir: path.join(root, "data"),
      accountsDir: path.join(root, "data", "accounts"),
      databasePath: path.join(root, "data", "gateway.db"),
    },
    { backgroundTasks: false },
  );
  for (const id of ["first", "second", "third"]) {
    gateway.database.accounts.insert({ id, codexHome: path.join(root, id) });
    gateway.database.accounts.update(id, { chatgptAccountId: id, authStatus: "ready" });
  }
});

afterAll(async () => {
  await gateway.app.close();
  await rm(root, { recursive: true, force: true });
});

describe("auto-switch API", () => {
  it("starts switched off, so an upgrade changes nobody's routing", async () => {
    const body = (await gateway.app.inject({ method: "GET", url: "/api/auto-switch" })).json();
    expect(body.settings.enabled).toBe(false);
    expect(body.settings.dryRun).toBe(true);
    expect(body.recent).toEqual([]);
  });

  it("refuses a write without the CSRF proof", async () => {
    const response = await gateway.app.inject({
      method: "PATCH",
      url: "/api/auto-switch",
      payload: { enabled: true },
    });
    expect(response.statusCode).toBe(403);
  });

  it("rejects a threshold that is not a percentage", async () => {
    const headers = await csrfHeaders();
    for (const thresholdPercent of [-1, 101, "25"]) {
      const response = await gateway.app.inject({
        method: "PATCH",
        url: "/api/auto-switch",
        headers,
        payload: { enabled: true, thresholdPercent },
      });
      expect(response.statusCode).toBe(400);
    }
  });

  it("keeps the order the user dragged into place", async () => {
    const headers = await csrfHeaders();
    const response = await gateway.app.inject({
      method: "PATCH",
      url: "/api/auto-switch/priority",
      headers,
      payload: { order: ["third", "first", "second"] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().candidateIds).toEqual(["third", "first", "second"]);
    expect(gateway.database.accounts.get("third")?.autoSwitchRank).toBe(0);
  });

  it("drops an account out of the rotation without removing it from the pool", async () => {
    const headers = await csrfHeaders();
    await gateway.app.inject({
      method: "PATCH",
      url: "/api/auto-switch/priority",
      headers,
      payload: { enrolled: { first: false } },
    });
    const body = (await gateway.app.inject({ method: "GET", url: "/api/auto-switch" })).json();
    expect(body.candidateIds).not.toContain("first");
    // Still an account, still routable by hand.
    expect(gateway.database.accounts.get("first")?.enabled).toBe(true);
  });

  it("refuses an order naming an account that does not exist", async () => {
    const headers = await csrfHeaders();
    const response = await gateway.app.inject({
      method: "PATCH",
      url: "/api/auto-switch/priority",
      headers,
      payload: { order: ["first", "ghost"] },
    });
    // account_not_found is 404 across this API; a stale console sending a
    // deleted account is exactly that rather than a malformed request.
    expect(response.statusCode).toBe(404);
    expect(gateway.database.accounts.get("first")?.autoSwitchRank).not.toBe(0);
  });

  it("refuses an order that names the same account twice", async () => {
    const headers = await csrfHeaders();
    const response = await gateway.app.inject({
      method: "PATCH",
      url: "/api/auto-switch/priority",
      headers,
      payload: { order: ["first", "first"] },
    });
    expect(response.statusCode).toBe(400);
  });
});
