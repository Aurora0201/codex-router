import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGateway, type GatewayApp } from "../src/app.js";
import { nextBillingAt } from "../src/api/local/billing-cycle.js";

let root: string;
let gateway: GatewayApp;

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "local-status-"));
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
});

afterAll(async () => {
  await gateway.app.close();
  await rm(root, { recursive: true, force: true });
});

describe("local status API", () => {
  it("answers a local caller with the figures the console card shows", async () => {
    const response = await gateway.app.inject({ method: "GET", url: "/api/local/v1/status" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.contractVersion).toBe(1);
    expect(body.gateway.version).toBeTruthy();
    expect(typeof body.today.requests).toBe("number");
    expect(typeof body.today.errors).toBe("number");
    expect(Array.isArray(body.accounts)).toBe(true);
  });

  it("refuses anything carrying a browser origin", async () => {
    // A page on any site may fetch 127.0.0.1, and account emails are in here.
    for (const headers of [{ origin: "http://evil.example" }, { referer: "http://127.0.0.1:5173/" }]) {
      const response = await gateway.app.inject({ method: "GET", url: "/api/local/v1/status", headers });
      expect(response.statusCode).toBe(403);
      expect(response.json().error).toBe("not_a_local_caller");
    }
  });

  it("states what is left, not only what was used", async () => {
    const id = "account-under-test";
    gateway.database.accounts.insert({ id, codexHome: path.join(root, "home") });
    gateway.database.accounts.update(id, {
      chatgptAccountId: "acct-1",
      email: "someone@example.com",
      planType: "plus",
    });
    gateway.database.accounts.updateRateLimits(id, {
      primary: { usedPercent: 6, resetsAt: Date.UTC(2026, 8, 8), windowDurationMins: 300 },
      secondary: null,
      rateLimitReachedType: null,
      planType: "plus",
      buckets: [],
      defaultBucketKey: null,
      resetCredits: null,
      loadedAt: Date.now(),
    });

    const body = (await gateway.app.inject({ method: "GET", url: "/api/local/v1/status" })).json();
    const view = body.accounts.find((item: { id: string }) => item.id === id);
    expect(view.quota.primary.usedPercent).toBe(6);
    // Reading this backwards is the easiest mistake to make against the payload.
    expect(view.quota.primary.remainingPercent).toBe(94);
    expect(view.quota.primary.resetsAt).toBe(Date.UTC(2026, 8, 8));
    expect(view.email).toBe("someone@example.com");
  });
});

describe("billing cycle parity", () => {
  // The console renders the same date from its own copy in
  // web/src/lib/billing-cycle.ts. These cases are the contract between them.
  it("keeps the billing day itself current", () => {
    expect(nextBillingAt(Date.UTC(2026, 0, 24), "monthly", Date.UTC(2026, 8, 24))).toBe(Date.UTC(2026, 8, 24));
  });

  it("clamps an anchor past the end of a shorter month", () => {
    expect(nextBillingAt(Date.UTC(2026, 2, 31), "monthly", Date.UTC(2026, 3, 1))).toBe(Date.UTC(2026, 3, 30));
  });

  it("rolls a december anchor into the next year", () => {
    expect(nextBillingAt(Date.UTC(2026, 11, 15), "monthly", Date.UTC(2026, 11, 16))).toBe(Date.UTC(2027, 0, 15));
  });

  it("returns nothing without both an anchor and a cadence", () => {
    expect(nextBillingAt(null, "monthly")).toBeNull();
    expect(nextBillingAt(Date.UTC(2026, 0, 1), null)).toBeNull();
  });
});
