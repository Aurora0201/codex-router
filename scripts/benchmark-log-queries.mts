import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { GatewayDatabase } from "../server/src/db/database.js";
import { RequestLogRepository } from "../server/src/db/repositories/request-log-repository.js";
import { WebSocketConnectionLogRepository } from "../server/src/db/repositories/websocket-connection-log-repository.js";

const root = await mkdtemp(path.join(os.tmpdir(), "router-log-benchmark-"));
const database = new GatewayDatabase(path.join(root, "benchmark.db"));
try {
  const insert = database.raw.prepare("INSERT INTO request_log(id, route, transport, state, outcome, http_status, started_at, completed_at) VALUES (?, '/responses', 'http', 'completed', 'success', 200, ?, ?)");
  const insertConnection = database.raw.prepare("INSERT INTO websocket_connection_log(id, connection_id, identity_mode, outcome, started_at, closed_at) VALUES (?, ?, 'managed_account', 'closed', ?, ?)");
  const measure = (operation: () => unknown) => {
    operation();
    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      operation();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { medianMs: Number(samples[2].toFixed(2)), maxMs: Number(samples[4].toFixed(2)) };
  };
  for (const count of [10_000, 100_000]) {
    database.raw.transaction(() => {
      for (let i = count === 10_000 ? 0 : 10_000; i < count; i++) {
        insert.run(String(i), i * 1000, i * 1000 + 50);
        insertConnection.run(String(i), String(i), i * 1000, i * 1000 + 50);
      }
    })();
    for (const [name, factory] of [
      ["requests", () => new RequestLogRepository(database.raw, database.settings)],
      ["connections", () => new WebSocketConnectionLogRepository(database.raw)],
    ] as const) {
      const filters = { since: 0, until: count * 1000, limit: 50, page: 1 };
      const warm = factory();
      warm.query(filters);
      let page = 1;
      console.log(JSON.stringify({
        table: name, rows: count,
        cold: measure(() => factory().query(filters)),
        cachedPagination: measure(() => warm.query({ ...filters, page: page++ % 10 + 1 })),
      }));
    }
  }
} finally {
  database.close();
  if (path.dirname(root) !== os.tmpdir()) throw new Error("unexpected_temp_path");
  await rm(root, { recursive: true, force: true });
}
