import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  FailureSource,
  FailureStage,
  IdentityMode,
  RequestOutcome,
  RequestState,
  Transport,
} from "../../types.js";
import type { RequestEvidence } from "../../proxy/request-classification.js";
import type { SettingsRepository } from "./settings-repository.js";

type SqliteDatabase = Database.Database;

export interface StartRequestInput {
  id?: string;
  requestId?: string;
  route: string;
  transport: Transport;
  accountId?: string;
  identityMode?: IdentityMode;
  startedAt?: number;
  bytesIn?: number;
}

export interface FinishRequestInput extends RequestEvidence {
  bytesIn?: number;
  bytesOut?: number;
  completedAt?: number;
}

export interface RequestLogFilters {
  since: number;
  until?: number;
  status?: "success" | "rejected" | "error" | "cancelled" | "running";
  state?: RequestState;
  outcome?: RequestOutcome;
  failureSource?: FailureSource;
  failureStage?: FailureStage;
  httpStatus?: number;
  protocolErrorCode?: string;
  diagnosticCode?: string;
  transport?: Transport;
  accountId?: string;
  query?: string;
  cursor?: { createdAt: number; id: string };
  page?: number;
  limit: number;
}

export interface RequestLogView {
  id: string;
  requestId?: string;
  route: string;
  transport: Transport;
  accountId?: string;
  accountLabel: string | null;
  state: RequestState;
  outcome: RequestOutcome | null;
  failureSource?: FailureSource;
  failureStage?: FailureStage;
  httpStatus?: number;
  protocolErrorCode?: string;
  diagnosticCode?: string;
  upstreamRequestId?: string;
  diagnosticHeaders?: Record<string, string>;
  transportErrorChain?: Array<{ name?: string; code?: string }>;
  bytesIn?: number;
  bytesOut?: number;
  identityMode: IdentityMode;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  /** @deprecated */ statusCode?: number;
  /** @deprecated */ errorCode?: string;
}

interface RequestLogRow {
  id: string;
  request_id: string | null;
  route: string;
  transport: Transport;
  account_id: string | null;
  account_label: string | null;
  state: RequestState;
  outcome: RequestOutcome | null;
  failure_source: FailureSource | null;
  failure_stage: FailureStage | null;
  http_status: number | null;
  protocol_error_code: string | null;
  diagnostic_code: string | null;
  upstream_request_id: string | null;
  diagnostic_headers_json: string | null;
  transport_error_json: string | null;
  bytes_in: number | null;
  bytes_out: number | null;
  identity_mode: IdentityMode;
  started_at: number;
  completed_at: number | null;
}

function view(row: RequestLogRow): RequestLogView {
  const durationMs =
    row.completed_at === null ? undefined : row.completed_at - row.started_at;
  const statusCode =
    row.http_status ??
    (row.transport === "ws" && row.state === "completed" ? 200 : undefined);
  return {
    id: row.id,
    requestId: row.request_id ?? undefined,
    route: row.route,
    transport: row.transport,
    accountId: row.account_id ?? undefined,
    accountLabel: row.account_label,
    state: row.state,
    outcome: row.outcome,
    failureSource: row.failure_source ?? undefined,
    failureStage: row.failure_stage ?? undefined,
    httpStatus: row.http_status ?? undefined,
    protocolErrorCode: row.protocol_error_code ?? undefined,
    diagnosticCode: row.diagnostic_code ?? undefined,
    upstreamRequestId: row.upstream_request_id ?? undefined,
    diagnosticHeaders: row.diagnostic_headers_json
      ? (JSON.parse(row.diagnostic_headers_json) as Record<string, string>)
      : undefined,
    transportErrorChain: row.transport_error_json
      ? (JSON.parse(row.transport_error_json) as Array<{
          name?: string;
          code?: string;
        }>)
      : undefined,
    bytesIn: row.bytes_in ?? undefined,
    bytesOut: row.bytes_out ?? undefined,
    identityMode: row.identity_mode,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    durationMs,
    statusCode,
    errorCode: row.protocol_error_code ?? row.diagnostic_code ?? undefined,
  };
}

export class RequestLogRepository {
  onStarted?: (id: string) => void;
  onFinished?: (id: string) => void;

  constructor(
    private readonly db: SqliteDatabase,
    private readonly settings: SettingsRepository,
  ) {}

  startRequest(input: StartRequestInput): string | null {
    if (!this.settings.requestMetadataLoggingEnabled()) return null;
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO request_log(
      id, request_id, route, transport, account_id, state, outcome, bytes_in, identity_mode, started_at
    ) VALUES (?, ?, ?, ?, ?, 'running', NULL, ?, ?, ?)`,
      )
      .run(
        id,
        input.requestId ?? null,
        input.route,
        input.transport,
        input.accountId ?? null,
        input.bytesIn ?? null,
        input.identityMode ?? "managed_account",
        input.startedAt ?? Date.now(),
      );
    this.onStarted?.(id);
    return id;
  }

  finishRequest(id: string | null, input: FinishRequestInput): boolean {
    if (!id) return false;
    const result = this.db
      .prepare(
        `UPDATE request_log SET
      state=?, outcome=?, failure_source=?, failure_stage=?, http_status=?, protocol_error_code=?,
      diagnostic_code=?, upstream_request_id=?, diagnostic_headers_json=?, transport_error_json=?, bytes_in=COALESCE(?, bytes_in),
      bytes_out=COALESCE(?, bytes_out), completed_at=? WHERE id=? AND state='running'`,
      )
      .run(
        input.state,
        input.outcome,
        input.failureSource ?? null,
        input.failureStage ?? null,
        input.httpStatus ?? null,
        input.protocolErrorCode ?? null,
        input.diagnosticCode ?? null,
        input.upstreamRequestId ?? null,
        input.diagnosticHeaders
          ? JSON.stringify(input.diagnosticHeaders)
          : null,
        input.transportErrorChain
          ? JSON.stringify(input.transportErrorChain)
          : null,
        input.bytesIn ?? null,
        input.bytesOut ?? null,
        input.completedAt ?? Date.now(),
        id,
      );
    if (result.changes > 0) this.onFinished?.(id);
    return result.changes > 0;
  }

  setContext(
    id: string | null,
    input: { accountId?: string; identityMode: IdentityMode; bytesIn?: number },
  ): void {
    if (!id) return;
    this.db
      .prepare(
        "UPDATE request_log SET account_id=?, identity_mode=?, bytes_in=COALESCE(?,bytes_in) WHERE id=? AND state='running'",
      )
      .run(
        input.accountId ?? null,
        input.identityMode,
        input.bytesIn ?? null,
        id,
      );
  }

  interruptRunning(completedAt = Date.now()): number {
    const result = this.db
      .prepare(
        `UPDATE request_log SET state='interrupted', outcome='gateway_error',
      failure_source='gateway', failure_stage=NULL, diagnostic_code='gateway_process_interrupted', completed_at=?
      WHERE state='running'`,
      )
      .run(completedAt);
    return result.changes;
  }

  todayCounts(): { requests: number; errors: number } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS requests,
      SUM(CASE WHEN outcome IN ('upstream_error','gateway_error') THEN 1 ELSE 0 END) AS errors
      FROM request_log WHERE started_at >= ? AND state <> 'running'`,
      )
      .get(today.getTime()) as { requests: number; errors: number };
    return { requests: row.requests ?? 0, errors: row.errors ?? 0 };
  }

  query(filters: RequestLogFilters) {
    const where = ["request_log.started_at >= ?"];
    const values: Array<string | number> = [filters.since];
    if (filters.until !== undefined) {
      where.push("request_log.started_at <= ?");
      values.push(filters.until);
    }
    if (filters.status === "success")
      where.push("request_log.outcome='success'");
    if (filters.status === "rejected")
      where.push("request_log.outcome='rejected'");
    if (filters.status === "error")
      where.push("request_log.outcome IN ('upstream_error','gateway_error')");
    if (filters.status === "cancelled")
      where.push("request_log.outcome='client_cancelled'");
    if (filters.status === "running") where.push("request_log.state='running'");
    if (filters.state) {
      where.push("request_log.state=?");
      values.push(filters.state);
    }
    if (filters.outcome) {
      where.push("request_log.outcome=?");
      values.push(filters.outcome);
    }
    if (filters.failureSource) {
      where.push("request_log.failure_source=?");
      values.push(filters.failureSource);
    }
    if (filters.failureStage) {
      where.push("request_log.failure_stage=?");
      values.push(filters.failureStage);
    }
    if (filters.httpStatus !== undefined) {
      where.push("request_log.http_status=?");
      values.push(filters.httpStatus);
    }
    if (filters.protocolErrorCode) {
      where.push("request_log.protocol_error_code=?");
      values.push(filters.protocolErrorCode);
    }
    if (filters.diagnosticCode) {
      where.push("request_log.diagnostic_code=?");
      values.push(filters.diagnosticCode);
    }
    if (filters.transport) {
      where.push("request_log.transport=?");
      values.push(filters.transport);
    }
    if (filters.accountId) {
      if (filters.accountId === "__client_passthrough__")
        where.push("request_log.identity_mode='client_passthrough'");
      else {
        where.push("request_log.account_id=?");
        values.push(filters.accountId);
      }
    }
    if (filters.query) {
      where.push(
        "(request_log.request_id LIKE ? OR request_log.route LIKE ? OR request_log.protocol_error_code LIKE ? OR request_log.diagnostic_code LIKE ? OR request_log.upstream_request_id LIKE ? OR accounts.email LIKE ? OR accounts.chatgpt_account_id LIKE ?)",
      );
      const search = `%${filters.query}%`;
      values.push(search, search, search, search, search, search, search);
    }
    const baseWhere = where.join(" AND ");
    const summary = this.db
      .prepare(
        `SELECT
      COUNT(CASE WHEN state <> 'running' THEN 1 END) requests,
      COUNT(CASE WHEN outcome IN ('upstream_error','gateway_error') THEN 1 END) errors,
      COUNT(CASE WHEN outcome='rejected' THEN 1 END) rejected,
      COUNT(CASE WHEN outcome='client_cancelled' THEN 1 END) cancelled,
      COUNT(CASE WHEN outcome IN ('success','upstream_error') THEN 1 END) availability_requests,
      COUNT(CASE WHEN outcome='upstream_error' THEN 1 END) availability_errors,
      AVG(CASE WHEN state <> 'running' THEN completed_at-started_at END) average_duration_ms
      FROM request_log LEFT JOIN accounts ON accounts.id=request_log.account_id WHERE ${baseWhere}`,
      )
      .get(...values) as Record<string, number | null>;
    const timelineRows = this.db
      .prepare(
        `SELECT request_log.id, request_log.started_at, request_log.completed_at, request_log.http_status, request_log.state, request_log.outcome, request_log.transport
      FROM request_log LEFT JOIN accounts ON accounts.id=request_log.account_id
      WHERE ${baseWhere} AND request_log.state <> 'running' ORDER BY request_log.started_at DESC, request_log.id DESC LIMIT 500`,
      )
      .all(...values) as Array<{
      id: string;
      started_at: number;
      completed_at: number;
      http_status: number | null;
      state: RequestState;
      outcome: RequestOutcome;
      transport: Transport;
    }>;
    const totalItems = (
      this.db
        .prepare(
          `SELECT COUNT(*) count FROM request_log LEFT JOIN accounts ON accounts.id=request_log.account_id WHERE ${baseWhere}`,
        )
        .get(...values) as { count: number }
    ).count;
    const totalPages = Math.ceil(totalItems / filters.limit);
    const requestedPage = filters.page ?? 1;
    const currentPage =
      totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
    const pageWhere = [...where];
    const pageValues = [...values];
    if (filters.cursor) {
      pageWhere.push(
        "(request_log.started_at < ? OR (request_log.started_at=? AND request_log.id<?))",
      );
      pageValues.push(
        filters.cursor.createdAt,
        filters.cursor.createdAt,
        filters.cursor.id,
      );
    }
    const rows = this.db
      .prepare(
        `SELECT request_log.*, COALESCE(accounts.email,accounts.chatgpt_account_id,accounts.id) account_label
      FROM request_log LEFT JOIN accounts ON accounts.id=request_log.account_id WHERE ${pageWhere.join(" AND ")}
      ORDER BY request_log.started_at DESC, request_log.id DESC LIMIT ? OFFSET ?`,
      )
      .all(
        ...pageValues,
        filters.limit + 1,
        filters.page ? (currentPage - 1) * filters.limit : 0,
      ) as RequestLogRow[];
    const page = rows.slice(0, filters.limit);
    const last = page.at(-1);
    return {
      items: page.map(view),
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
        startedAt: row.started_at,
        createdAt: row.started_at,
        durationMs: row.completed_at - row.started_at,
        httpStatus: row.http_status,
        statusCode:
          row.http_status ??
          (row.transport === "ws" && row.state === "completed" ? 200 : null),
        outcome: row.outcome,
      })),
      nextCursor:
        rows.length > filters.limit && last
          ? { createdAt: last.started_at, id: last.id }
          : null,
      pagination: {
        page: currentPage,
        pageSize: filters.limit,
        totalItems,
        totalPages,
      },
    };
  }
}
