import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Transport } from "../../types.js";
import type { SettingsRepository } from "./settings-repository.js";

type SqliteDatabase = Database.Database;

export interface RequestLogEntry {
  requestId?: string;
  route: string;
  transport: Transport;
  accountId?: string;
  statusCode?: number;
  durationMs?: number;
  bytesIn?: number;
  bytesOut?: number;
  errorCode?: string;
}

export interface RequestLogFilters {
  since: number;
  status?: "success" | "error";
  transport?: Transport;
  accountId?: string;
  query?: string;
  cursor?: { createdAt: number; id: string };
  limit: number;
}

export interface RequestLogView extends RequestLogEntry {
  id: string;
  accountLabel: string | null;
  createdAt: number;
}

interface RequestLogRow {
  id: string;
  request_id: string | null;
  route: string;
  transport: Transport;
  account_id: string | null;
  account_label: string | null;
  status_code: number | null;
  duration_ms: number | null;
  bytes_in: number | null;
  bytes_out: number | null;
  error_code: string | null;
  created_at: number;
}

export class RequestLogRepository {
  onLogged?: () => void;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly settings: SettingsRepository,
  ) {}

  log(input: RequestLogEntry): void {
    if (!this.settings.requestMetadataLoggingEnabled()) return;
    this.db.prepare(`
      INSERT INTO request_log(id, request_id, route, transport, account_id, status_code, duration_ms, bytes_in, bytes_out, error_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), input.requestId ?? null, input.route, input.transport, input.accountId ?? null,
      input.statusCode ?? null, input.durationMs ?? null, input.bytesIn ?? null, input.bytesOut ?? null,
      input.errorCode ?? null, Date.now(),
    );
    this.onLogged?.();
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

  query(filters: RequestLogFilters): {
    items: RequestLogView[];
    summary: { requests: number; errors: number; averageDurationMs: number | null };
    timeline: Array<{ id: string; createdAt: number; durationMs: number; statusCode: number | null }>;
    nextCursor: { createdAt: number; id: string } | null;
  } {
    const where = ["request_log.created_at >= ?"];
    const values: Array<string | number> = [filters.since];
    if (filters.status === "success") where.push("COALESCE(request_log.status_code, 0) < 400");
    if (filters.status === "error") where.push("request_log.status_code >= 400");
    if (filters.transport) {
      where.push("request_log.transport = ?");
      values.push(filters.transport);
    }
    if (filters.accountId) {
      where.push("request_log.account_id = ?");
      values.push(filters.accountId);
    }
    if (filters.query) {
      where.push("(request_log.request_id LIKE ? OR request_log.route LIKE ? OR request_log.error_code LIKE ? OR accounts.email LIKE ? OR accounts.chatgpt_account_id LIKE ?)");
      const search = `%${filters.query}%`;
      values.push(search, search, search, search, search);
    }
    const baseWhere = where.join(" AND ");
    const summary = this.db.prepare(`
      SELECT COUNT(*) AS requests,
        SUM(CASE WHEN request_log.status_code >= 400 THEN 1 ELSE 0 END) AS errors,
        AVG(request_log.duration_ms) AS average_duration_ms
      FROM request_log LEFT JOIN accounts ON accounts.id = request_log.account_id
      WHERE ${baseWhere}
    `).get(...values) as { requests: number; errors: number | null; average_duration_ms: number | null };
    const timelineRows = this.db.prepare(`
      SELECT request_log.id, request_log.created_at, request_log.duration_ms, request_log.status_code
      FROM request_log LEFT JOIN accounts ON accounts.id = request_log.account_id
      WHERE ${baseWhere} AND request_log.duration_ms IS NOT NULL
      ORDER BY request_log.created_at DESC, request_log.id DESC LIMIT 500
    `).all(...values) as Array<{
      id: string;
      created_at: number;
      duration_ms: number;
      status_code: number | null;
    }>;

    const pageWhere = [...where];
    const pageValues = [...values];
    if (filters.cursor) {
      pageWhere.push("(request_log.created_at < ? OR (request_log.created_at = ? AND request_log.id < ?))");
      pageValues.push(filters.cursor.createdAt, filters.cursor.createdAt, filters.cursor.id);
    }
    const rows = this.db.prepare(`
      SELECT request_log.*, COALESCE(accounts.email, accounts.chatgpt_account_id, accounts.id) AS account_label
      FROM request_log LEFT JOIN accounts ON accounts.id = request_log.account_id
      WHERE ${pageWhere.join(" AND ")}
      ORDER BY request_log.created_at DESC, request_log.id DESC LIMIT ?
    `).all(...pageValues, filters.limit + 1) as RequestLogRow[];
    const hasMore = rows.length > filters.limit;
    const page = rows.slice(0, filters.limit);
    const items = page.map((row) => ({
      id: row.id,
      requestId: row.request_id ?? undefined,
      route: row.route,
      transport: row.transport,
      accountId: row.account_id ?? undefined,
      accountLabel: row.account_label,
      statusCode: row.status_code ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      bytesIn: row.bytes_in ?? undefined,
      bytesOut: row.bytes_out ?? undefined,
      errorCode: row.error_code ?? undefined,
      createdAt: row.created_at,
    }));
    const last = page.at(-1);
    return {
      items,
      summary: {
        requests: summary.requests ?? 0,
        errors: summary.errors ?? 0,
        averageDurationMs: summary.average_duration_ms,
      },
      timeline: timelineRows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        durationMs: row.duration_ms,
        statusCode: row.status_code,
      })),
      nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
    };
  }
}
