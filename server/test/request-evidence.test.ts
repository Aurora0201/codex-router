import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayDatabase } from "../src/db/database.js";
import {
  classifyHttpStatus,
  classifyProtocolTerminal,
} from "../src/proxy/request-classification.js";

const roots: string[] = [];
async function databasePath(name: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "request-evidence-"));
  roots.push(root);
  return path.join(root, name);
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("request evidence lifecycle", () => {
  it("inserts running immediately and completes the same record once", async () => {
    const database = new GatewayDatabase(await databasePath("lifecycle.db"));
    const started = vi.fn();
    const finished = vi.fn();
    database.requestLog.onStarted = started;
    database.requestLog.onFinished = finished;
    const id = database.requestLog.startRequest({
      requestId: "request-1",
      route: "/responses",
      transport: "ws",
      startedAt: 100,
      bytesIn: 12,
    })!;
    expect(
      database.requestLog.query({ since: 0, status: "running", limit: 10 })
        .items[0],
    ).toMatchObject({ id, state: "running", outcome: null });
    expect(
      database.requestLog.finishRequest(id, {
        ...classifyProtocolTerminal("response.completed")!,
        completedAt: 150,
        bytesOut: 20,
      }),
    ).toBe(true);
    expect(
      database.requestLog.finishRequest(id, {
        ...classifyProtocolTerminal("response.failed", "late_error")!,
        completedAt: 160,
      }),
    ).toBe(false);
    expect(
      database.requestLog.query({ since: 0, limit: 10 }).items[0],
    ).toMatchObject({
      id,
      state: "completed",
      outcome: "success",
      statusCode: 200,
      durationMs: 50,
    });
    expect(started).toHaveBeenCalledWith(id);
    expect(finished).toHaveBeenCalledOnce();
    database.close();
  });

  it("interrupts running records on the next process start", async () => {
    const file = await databasePath("interrupted.db");
    const first = new GatewayDatabase(file);
    first.requestLog.startRequest({
      route: "/responses",
      transport: "http",
      startedAt: 100,
    });
    first.close();
    const second = new GatewayDatabase(file);
    expect(
      second.requestLog.query({ since: 0, limit: 10 }).items[0],
    ).toMatchObject({
      state: "interrupted",
      outcome: "gateway_error",
      failureSource: "gateway",
      failureStage: undefined,
      diagnosticCode: "gateway_process_interrupted",
    });
    second.close();
  });

  it("keeps unknown protocol codes and separates HTTP classification", () => {
    expect(
      classifyProtocolTerminal("response.failed", "future_private_code"),
    ).toMatchObject({
      state: "failed",
      outcome: "upstream_error",
      protocolErrorCode: "future_private_code",
    });
    expect(
      classifyProtocolTerminal("error", "usage_limit_reached", 429),
    ).toMatchObject({
      state: "failed",
      outcome: "upstream_error",
      httpStatus: 429,
      protocolErrorCode: "usage_limit_reached",
    });
    expect(classifyHttpStatus(422)).toMatchObject({
      state: "rejected",
      outcome: "rejected",
      httpStatus: 422,
    });
    expect(classifyHttpStatus(429)).toMatchObject({
      state: "failed",
      outcome: "upstream_error",
      httpStatus: 429,
    });
  });

  it("filters lifecycle evidence independently and summarizes all matching rows", async () => {
    const database = new GatewayDatabase(await databasePath("filters.db"));
    const first = database.requestLog.startRequest({
      route: "/responses",
      transport: "http",
      startedAt: 100,
    })!;
    database.requestLog.finishRequest(first, {
      state: "failed",
      outcome: "upstream_error",
      failureSource: "upstream_protocol",
      failureStage: "terminal",
      httpStatus: 429,
      protocolErrorCode: "rate_limit_exceeded",
      diagnosticCode: "retry_exhausted",
      completedAt: 120,
    });
    const second = database.requestLog.startRequest({
      route: "/models",
      transport: "models",
      startedAt: 200,
    })!;
    database.requestLog.finishRequest(second, {
      state: "completed",
      outcome: "success",
      httpStatus: 200,
      completedAt: 230,
    });
    const result = database.requestLog.query({
      since: 50,
      until: 150,
      state: "failed",
      outcome: "upstream_error",
      failureSource: "upstream_protocol",
      failureStage: "terminal",
      httpStatus: 429,
      protocolErrorCode: "rate_limit_exceeded",
      diagnosticCode: "retry_exhausted",
      page: 1,
      limit: 1,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: first,
      state: "failed",
      protocolErrorCode: "rate_limit_exceeded",
    });
    expect(result.summary.requests).toBe(1);
    database.close();
  });

  it("persists structured transport errors across database reopen", async () => {
    const file = await databasePath("transport-errors.db");
    const database = new GatewayDatabase(file);
    const id = database.requestLog.startRequest({
      route: "/alpha/search",
      transport: "search",
      startedAt: 100,
    })!;
    database.requestLog.finishRequest(id, {
      state: "failed",
      outcome: "upstream_error",
      failureSource: "transport",
      failureStage: "sending",
      diagnosticCode: "ETIMEDOUT",
      transportErrorChain: [
        { name: "ConnectTimeoutError", code: "UND_ERR_CONNECT_TIMEOUT" },
        { name: "Error", code: "ETIMEDOUT" },
      ],
      completedAt: 200,
    });
    database.close();

    const reopened = new GatewayDatabase(file);
    expect(reopened.requestLog.query({ since: 0, limit: 10 }).items[0]).toMatchObject({
      diagnosticCode: "ETIMEDOUT",
      transportErrorChain: [
        { name: "ConnectTimeoutError", code: "UND_ERR_CONNECT_TIMEOUT" },
        { name: "Error", code: "ETIMEDOUT" },
      ],
    });
    reopened.close();
  });

  it("filters connection evidence and summarizes beyond the current page", async () => {
    const database = new GatewayDatabase(
      await databasePath("connection-filters.db"),
    );
    for (let index = 0; index < 3; index++) {
      const id = database.websocketConnectionLog.start({
        connectionId: `connection-${index}`,
        identityMode: "managed_account",
        startedAt: 100 + index,
      });
      database.websocketConnectionLog.finish(id, {
        closedAt: 200 + index,
        handshakeHttpStatus: 101,
        clientCloseCode: index === 0 ? 1000 : undefined,
        upstreamCloseCode: index > 0 ? 1011 : undefined,
        closeInitiator: index === 0 ? "client" : "upstream",
        closeReasonCode: index === 0 ? "normal_close" : "upstream_closed_1011",
        outcome: index === 0 ? "retired" : "failed",
      });
    }
    const result = database.websocketConnectionLog.query({
      since: 0,
      outcome: "failed",
      closeInitiator: "upstream",
      handshakeHttpStatus: 101,
      upstreamCloseCode: 1011,
      page: 1,
      limit: 1,
    });
    expect(result.items).toHaveLength(1);
    expect(result.summary).toEqual({ connections: 2, failures: 2, retired: 0 });
    expect(result.pagination.totalPages).toBe(2);
    database.close();
  });

  it("migrates historical connection scope separately and idempotently", async () => {
    const file = await databasePath("migration.db");
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
      INSERT INTO schema_migrations VALUES(8,1);
      CREATE TABLE gateway_state(singleton INTEGER PRIMARY KEY,active_account_id TEXT);
      INSERT INTO gateway_state VALUES(1,NULL);
      CREATE TABLE request_log(id TEXT PRIMARY KEY,request_id TEXT,route TEXT NOT NULL,transport TEXT NOT NULL,account_id TEXT,status_code INTEGER,duration_ms INTEGER,bytes_in INTEGER,bytes_out INTEGER,error_code TEXT,outcome TEXT NOT NULL,scope TEXT NOT NULL,identity_mode TEXT NOT NULL,created_at INTEGER NOT NULL);
      INSERT INTO request_log VALUES('request-old','request-1','/responses','http',NULL,200,20,1,2,NULL,'success','request','managed_account',100);
      INSERT INTO request_log VALUES('connection-old','connection-1','/responses','ws',NULL,101,30,NULL,NULL,'account_switch_connection_retired','success','connection','managed_account',200);
    `);
    legacy.close();
    const migrated = new GatewayDatabase(file);
    expect(
      migrated.requestLog.query({ since: 0, limit: 10 }).items,
    ).toHaveLength(1);
    expect(
      migrated.websocketConnectionLog.query({ since: 0, limit: 10 }).items[0],
    ).toMatchObject({
      connectionId: "connection-1",
      handshakeHttpStatus: 101,
      outcome: "retired",
      closeReasonCode: "account_switch_connection_retired",
    });
    migrated.close();
    const reopened = new GatewayDatabase(file);
    expect(
      reopened.websocketConnectionLog.query({ since: 0, limit: 10 }).items,
    ).toHaveLength(1);
    reopened.close();
  });
});
