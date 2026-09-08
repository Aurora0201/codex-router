import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayDatabase } from "../src/db/database.js";
import { LogQueryCache } from "../src/db/log-query-cache.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "log-query-test-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "gateway.db");
  const db = new GatewayDatabase(file);
  cleanup.push(async () => db.close());
  return { db, file };
}

describe("bounded log query caching", () => {
  it("reuses aggregates across pages without reusing page rows", async () => {
    const { db } = await fixture();
    for (let index = 0; index < 3; index++) {
      const id = db.requestLog.startRequest({ route: "/models", transport: "models", startedAt: 100 + index });
      db.requestLog.finishRequest(id, { state: "completed", outcome: "success", httpStatus: 200, completedAt: 200 });
    }
    const prepare = vi.spyOn(db.raw, "prepare");
    const first = db.requestLog.query({ since: 0, until: 1000, limit: 1, page: 1 });
    prepare.mockClear();
    const second = db.requestLog.query({ since: 0, until: 1000, limit: 1, page: 2 });
    expect(second.summary).toEqual(first.summary);
    expect(second.pagination.totalItems).toBe(3);
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect(prepare.mock.calls.some(([sql]) => /COUNT\(|GROUP BY/.test(sql))).toBe(false);
    first.histogram[0].requests = 999;
    expect(db.requestLog.query({ since: 0, until: 1000, limit: 1 }).histogram[0].requests).toBe(3);
  });

  it("invalidates immediately after request completion, account changes and external writes", async () => {
    const { db, file } = await fixture();
    db.accounts.insert({ id: "a", codexHome: "/test-account" });
    db.accounts.update("a", { email: "first@example.test" });
    const id = db.requestLog.startRequest({ route: "/models", transport: "models", accountId: "a", startedAt: 100 });
    const filters = { since: 0, until: 1000, limit: 10 };
    expect(db.requestLog.query(filters).summary.requests).toBe(0);
    db.requestLog.finishRequest(id, { state: "completed", outcome: "success", completedAt: 200 });
    expect(db.requestLog.query(filters).summary.requests).toBe(1);
    expect(db.requestLog.query({ ...filters, query: "second@" }).items).toHaveLength(0);
    db.accounts.update("a", { email: "second@example.test" });
    expect(db.requestLog.query({ ...filters, query: "second@" }).items[0].accountLabel).toBe("second@example.test");
    const external = new Database(file);
    try { external.prepare("UPDATE request_log SET outcome='upstream_error', state='failed' WHERE id=?").run(id); }
    finally { external.close(); }
    expect(db.requestLog.query(filters).summary.errors).toBe(1);
  });

  it("keeps a rolling window consistent for one second and then ages records out", async () => {
    const { db } = await fixture();
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const id = db.requestLog.startRequest({ route: "/models", transport: "models", startedAt: 9100 });
    db.requestLog.finishRequest(id, { state: "completed", outcome: "success", completedAt: 9200 });
    const filters = { since: 0, relativeRangeMs: 1000, limit: 10 };
    expect(db.requestLog.query(filters).items).toHaveLength(1);
    now.mockReturnValue(10_500);
    expect(db.requestLog.query(filters).items).toHaveLength(1);
    now.mockReturnValue(11_001);
    const expired = db.requestLog.query(filters);
    expect(expired.items).toHaveLength(0);
    expect(expired.pagination.totalItems).toBe(0);
  });

  it("does not retain transaction-local results after rollback and bounds cache entries", async () => {
    const { db } = await fixture();
    const cache = new LogQueryCache(db.raw);
    const read = vi.fn(() => db.accounts.list().length);
    expect(cache.get("count", read)).toBe(0);
    expect(() => db.raw.transaction(() => {
      db.accounts.insert({ id: "rolled-back", codexHome: "/rollback" });
      expect(cache.get("count", read)).toBe(1);
      throw new Error("rollback");
    })()).toThrow("rollback");
    expect(cache.get("count", read)).toBe(0);
    const count = read.mock.calls.length;
    for (let i = 0; i < 20; i++) cache.get("key:" + i, () => i);
    cache.get("count", read);
    expect(read.mock.calls.length).toBe(count + 1);
  });

  it("counts inclusive window-end records in the request histogram", async () => {
    const { db } = await fixture();
    const id = db.requestLog.startRequest({ route: "/models", transport: "models", startedAt: 60_000 });
    db.requestLog.finishRequest(id, { state: "completed", outcome: "success", completedAt: 60_001 });
    const result = db.requestLog.query({ since: 0, until: 60_000, limit: 10 });
    expect(result.summary.requests).toBe(1);
    expect(result.histogram.reduce((sum, bucket) => sum + bucket.requests, 0)).toBe(1);
  });

  it("refreshes connection aggregates after a terminal update", async () => {
    const { db } = await fixture();
    const id = db.websocketConnectionLog.start({ connectionId: "ws", identityMode: "managed_account", startedAt: 100 });
    const filters = { since: 0, until: 1000, limit: 10 };
    expect(db.websocketConnectionLog.query(filters).summary.failures).toBe(0);
    db.websocketConnectionLog.finish(id, { closedAt: 200, outcome: "failed" });
    expect(db.websocketConnectionLog.query(filters).summary.failures).toBe(1);
  });
});
