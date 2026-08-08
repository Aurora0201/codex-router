import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Transport } from "../../types.js";
import type { SettingsRepository } from "./settings-repository.js";

type SqliteDatabase = Database.Database;

export interface RequestLogEntry {
  requestId?: string;
  route: string;
  transport: Transport;
  accountId?: string;
  routingKey?: string;
  statusCode?: number;
  durationMs?: number;
  bytesIn?: number;
  bytesOut?: number;
  errorCode?: string;
}

export class RequestLogRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly settings: SettingsRepository,
  ) {}

  log(input: RequestLogEntry): void {
    if (!this.settings.requestMetadataLoggingEnabled()) return;
    this.db.prepare(`
      INSERT INTO request_log(id, request_id, route, transport, account_id, routing_key_hash, status_code, duration_ms, bytes_in, bytes_out, error_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), input.requestId ?? null, input.route, input.transport, input.accountId ?? null,
      input.routingKey ? createHash("sha256").update(input.routingKey).digest("hex").slice(0, 16) : null,
      input.statusCode ?? null, input.durationMs ?? null, input.bytesIn ?? null, input.bytesOut ?? null,
      input.errorCode ?? null, Date.now(),
    );
  }

  todayCounts(): { requests: number; errors: number } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const row = this.db.prepare(`
      SELECT COUNT(*) AS requests,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
      FROM request_log WHERE created_at >= ?
    `).get(today.getTime()) as { requests: number; errors: number };
    return { requests: row.requests ?? 0, errors: row.errors ?? 0 };
  }
}
