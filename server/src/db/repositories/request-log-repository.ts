import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { RequestOutcome, RequestScope, Transport } from "../../types.js";
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
  outcome?: RequestOutcome;
  scope?: RequestScope;
}

export interface RequestLogFilters {
  since: number;
  status?: "success" | "rejected" | "error" | "cancelled";
  transport?: Transport;
  accountId?: string;
  query?: string;
  cursor?: { createdAt: number; id: string };
  page?: number;
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
  outcome: RequestOutcome;
  scope: RequestScope;
  created_at: number;
}

const GATEWAY_ERRORS = new Set([
  "no_active_account_selected", "account_disabled", "account_not_ready",
  "fedramp_accounts_not_supported", "raw_request_body_unavailable",
]);

export function requestOutcome(statusCode?: number, errorCode?: string): RequestOutcome {
  if (errorCode === "client_cancelled" || errorCode?.toLowerCase() === "this operation was aborted") return "client_cancelled";
  if (errorCode && GATEWAY_ERRORS.has(errorCode)) return "gateway_error";
  if (statusCode !== undefined && statusCode >= 200 && statusCode < 400) return "success";
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) return "rejected";
  return "upstream_error";
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
      INSERT INTO request_log(id, request_id, route, transport, account_id, status_code, duration_ms, bytes_in, bytes_out, error_code, outcome, scope, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), input.requestId ?? null, input.route, input.transport, input.accountId ?? null,
      input.statusCode ?? null, input.durationMs ?? null, input.bytesIn ?? null, input.bytesOut ?? null,
      input.errorCode ?? null, input.outcome ?? requestOutcome(input.statusCode, input.errorCode), input.scope ?? "request", Date.now(),
    );
    this.onLogged?.();
  }

  todayCounts(): { requests: number; errors: number } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const row = this.db.prepare(`
      SELECT SUM(CASE WHEN scope = 'request' THEN 1 ELSE 0 END) AS requests,
      SUM(CASE WHEN scope = 'request' AND outcome IN ('upstream_error', 'gateway_error') THEN 1 ELSE 0 END) AS errors
      FROM request_log WHERE created_at >= ?
    `).get(today.getTime()) as { requests: number; errors: number };
    return { requests: row.requests ?? 0, errors: row.errors ?? 0 };
  }

  query(filters: RequestLogFilters): {
    items: RequestLogView[];
    summary: { requests: number; errors: number; rejected: number; cancelled: number; availabilityRequests: number; availabilityErrors: number; averageDurationMs: number | null };
    timeline: Array<{ id: string; createdAt: number; durationMs: number; statusCode: number | null; outcome: RequestOutcome }>;
    nextCursor: { createdAt: number; id: string } | null;
    pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  } {
    const where = ["request_log.created_at >= ?"];
    const values: Array<string | number> = [filters.since];
    if (filters.status === "success") where.push("request_log.outcome = 'success'");
    if (filters.status === "rejected") where.push("request_log.outcome = 'rejected'");
    if (filters.status === "error") where.push("request_log.outcome IN ('upstream_error', 'gateway_error')");
    if (filters.status === "cancelled") where.push("request_log.outcome = 'client_cancelled'");
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
      SELECT SUM(CASE WHEN request_log.scope = 'request' THEN 1 ELSE 0 END) AS requests,
        SUM(CASE WHEN request_log.scope = 'request' AND request_log.outcome IN ('upstream_error', 'gateway_error') THEN 1 ELSE 0 END) AS errors,
        SUM(CASE WHEN request_log.scope = 'request' AND request_log.outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN request_log.scope = 'request' AND request_log.outcome = 'client_cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN request_log.scope = 'request' AND request_log.outcome IN ('success', 'upstream_error') THEN 1 ELSE 0 END) AS availability_requests,
        SUM(CASE WHEN request_log.scope = 'request' AND request_log.outcome = 'upstream_error' THEN 1 ELSE 0 END) AS availability_errors,
        AVG(CASE WHEN request_log.scope = 'request' THEN request_log.duration_ms END) AS average_duration_ms
      FROM request_log LEFT JOIN accounts ON accounts.id = request_log.account_id
      WHERE ${baseWhere}
    `).get(...values) as { requests: number | null; errors: number | null; rejected: number | null; cancelled: number | null; availability_requests: number | null; availability_errors: number | null; average_duration_ms: number | null };
    const timelineRows = this.db.prepare(`
      SELECT request_log.id, request_log.created_at, request_log.duration_ms, request_log.status_code, request_log.outcome
      FROM request_log LEFT JOIN accounts ON accounts.id = request_log.account_id
      WHERE ${baseWhere} AND request_log.scope = 'request' AND request_log.duration_ms IS NOT NULL
      ORDER BY request_log.created_at DESC, request_log.id DESC LIMIT 500
    `).all(...values) as Array<{
      id: string;
      created_at: number;
      duration_ms: number;
      status_code: number | null;
      outcome: RequestOutcome;
    }>;

    const totalRow = this.db.prepare(`
      SELECT COUNT(*) AS count FROM request_log LEFT JOIN accounts ON accounts.id = request_log.account_id
      WHERE ${baseWhere}
    `).get(...values) as { count: number };
    const totalItems = totalRow.count ?? 0;
    const totalPages = Math.ceil(totalItems / filters.limit);
    const requestedPage = filters.page ?? 1;
    const currentPage = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
    const pageWhere = [...where];
    const pageValues = [...values];
    if (filters.cursor) {
      pageWhere.push("(request_log.created_at < ? OR (request_log.created_at = ? AND request_log.id < ?))");
      pageValues.push(filters.cursor.createdAt, filters.cursor.createdAt, filters.cursor.id);
    }
    const offset = filters.page ? (currentPage - 1) * filters.limit : 0;
    const rows = this.db.prepare(`
      SELECT request_log.*, COALESCE(accounts.email, accounts.chatgpt_account_id, accounts.id) AS account_label
      FROM request_log LEFT JOIN accounts ON accounts.id = request_log.account_id
      WHERE ${pageWhere.join(" AND ")}
      ORDER BY request_log.created_at DESC, request_log.id DESC LIMIT ? OFFSET ?
    `).all(...pageValues, filters.limit + 1, offset) as RequestLogRow[];
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
      outcome: row.outcome,
      scope: row.scope,
      createdAt: row.created_at,
    }));
    const last = page.at(-1);
    return {
      items,
      summary: {
        requests: summary.requests ?? 0,
        errors: summary.errors ?? 0,
        rejected: summary.rejected ?? 0,
        cancelled: summary.cancelled ?? 0,
        availabilityRequests: summary.availability_requests ?? 0,
        availabilityErrors: summary.availability_errors ?? 0,
        averageDurationMs: summary.average_duration_ms,
      },
      timeline: timelineRows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        durationMs: row.duration_ms,
        statusCode: row.status_code,
        outcome: row.outcome,
      })),
      nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
      pagination: {
        page: currentPage,
        pageSize: filters.limit,
        totalItems,
        totalPages,
      },
    };
  }
}
