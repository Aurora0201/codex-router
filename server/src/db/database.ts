import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type {
  AccountRecord,
  AuthStatus,
  RateLimitSnapshot,
  RoutingIdentity,
  SessionRecord,
  Transport,
} from "../types.js";

type SqliteDatabase = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  email TEXT,
  plan_type TEXT,
  codex_home TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  auth_status TEXT NOT NULL,
  fedramp INTEGER NOT NULL DEFAULT 0,
  primary_used_percent REAL,
  primary_resets_at INTEGER,
  primary_window_minutes INTEGER,
  secondary_used_percent REAL,
  secondary_resets_at INTEGER,
  secondary_window_minutes INTEGER,
  last_auth_refresh_at INTEGER,
  last_limits_refresh_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_bindings (
  routing_key TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  thread_id TEXT,
  session_id TEXT,
  transport TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS request_log (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  route TEXT NOT NULL,
  transport TEXT NOT NULL,
  account_id TEXT,
  routing_key_hash TEXT,
  status_code INTEGER,
  duration_ms INTEGER,
  bytes_in INTEGER,
  bytes_out INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_account ON session_bindings(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON session_bindings(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_log_created ON request_log(created_at DESC);
`;

function asAccount(row: Record<string, unknown>): AccountRecord {
  return {
    id: String(row.id),
    label: String(row.label),
    email: row.email == null ? null : String(row.email),
    planType: row.plan_type == null ? null : String(row.plan_type),
    codexHome: String(row.codex_home),
    enabled: Boolean(row.enabled),
    isDefault: Boolean(row.is_default),
    authStatus: String(row.auth_status) as AuthStatus,
    fedRamp: Boolean(row.fedramp),
    primaryUsedPercent: row.primary_used_percent == null ? null : Number(row.primary_used_percent),
    primaryResetsAt: row.primary_resets_at == null ? null : Number(row.primary_resets_at),
    primaryWindowMinutes: row.primary_window_minutes == null ? null : Number(row.primary_window_minutes),
    secondaryUsedPercent: row.secondary_used_percent == null ? null : Number(row.secondary_used_percent),
    secondaryResetsAt: row.secondary_resets_at == null ? null : Number(row.secondary_resets_at),
    secondaryWindowMinutes: row.secondary_window_minutes == null ? null : Number(row.secondary_window_minutes),
    lastAuthRefreshAt: row.last_auth_refresh_at == null ? null : Number(row.last_auth_refresh_at),
    lastLimitsRefreshAt: row.last_limits_refresh_at == null ? null : Number(row.last_limits_refresh_at),
    lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class GatewayDatabase {
  readonly raw: SqliteDatabase;
  private readonly activeRequests = new Map<string, number>();

  constructor(databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.raw = new Database(databasePath);
    this.raw.pragma("journal_mode = WAL");
    this.raw.pragma("foreign_keys = ON");
    this.raw.pragma("busy_timeout = 5000");
    this.raw.exec(SCHEMA);
    this.raw.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)").run(Date.now());
    this.raw.prepare("INSERT OR IGNORE INTO settings(key, value_json) VALUES ('requestMetadataLogging', 'true')").run();
    this.raw.prepare("INSERT OR IGNORE INTO settings(key, value_json) VALUES ('theme', '\"system\"')").run();
  }

  close(): void {
    this.raw.close();
  }

  listAccounts(): AccountRecord[] {
    return (this.raw.prepare("SELECT * FROM accounts ORDER BY is_default DESC, created_at ASC").all() as Record<string, unknown>[]).map(asAccount);
  }

  getAccount(id: string): AccountRecord | null {
    const row = this.raw.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? asAccount(row) : null;
  }

  getDefaultAccount(): AccountRecord | null {
    const row = this.raw.prepare("SELECT * FROM accounts WHERE enabled = 1 ORDER BY is_default DESC, created_at ASC LIMIT 1").get() as Record<string, unknown> | undefined;
    return row ? asAccount(row) : null;
  }

  createAccount(input: { id: string; label: string; codexHome: string }): AccountRecord {
    const now = Date.now();
    const hasDefault = Boolean(this.raw.prepare("SELECT 1 FROM accounts WHERE is_default = 1").get());
    this.raw.prepare(`
      INSERT INTO accounts(id, label, codex_home, enabled, is_default, auth_status, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, 'login_pending', ?, ?)
    `).run(input.id, input.label, input.codexHome, hasDefault ? 0 : 1, now, now);
    return this.getAccount(input.id)!;
  }

  updateAccount(
    id: string,
    updates: Partial<Pick<AccountRecord, "label" | "email" | "planType" | "enabled" | "authStatus" | "fedRamp">>,
  ): AccountRecord {
    const current = this.getAccount(id);
    if (!current) throw new Error("account_not_found");
    const next = { ...current, ...updates };
    this.raw.prepare(`
      UPDATE accounts SET label=?, email=?, plan_type=?, enabled=?, auth_status=?, fedramp=?, updated_at=? WHERE id=?
    `).run(next.label, next.email, next.planType, next.enabled ? 1 : 0, next.authStatus, next.fedRamp ? 1 : 0, Date.now(), id);
    if (!next.enabled && current.isDefault) {
      this.raw.transaction(() => {
        this.raw.prepare("UPDATE accounts SET is_default=0 WHERE is_default=1").run();
        const replacement = this.raw.prepare("SELECT id FROM accounts WHERE enabled=1 AND auth_status='ready' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
        if (replacement) this.raw.prepare("UPDATE accounts SET is_default=1, updated_at=? WHERE id=?").run(Date.now(), replacement.id);
      })();
    } else if (next.enabled && !this.raw.prepare("SELECT 1 FROM accounts WHERE is_default=1").get()) {
      this.raw.prepare("UPDATE accounts SET is_default=1, updated_at=? WHERE id=?").run(Date.now(), id);
    }
    return this.getAccount(id)!;
  }

  setDefaultAccount(id: string): AccountRecord {
    const account = this.getAccount(id);
    if (!account) throw new Error("account_not_found");
    if (!account.enabled || account.authStatus !== "ready") throw new Error("account_not_ready");
    this.raw.transaction(() => {
      this.raw.prepare("UPDATE accounts SET is_default=0, updated_at=? WHERE is_default=1").run(Date.now());
      this.raw.prepare("UPDATE accounts SET is_default=1, updated_at=? WHERE id=?").run(Date.now(), id);
    })();
    return this.getAccount(id)!;
  }

  updateRateLimits(id: string, limits: RateLimitSnapshot): void {
    this.raw.prepare(`
      UPDATE accounts SET
        primary_used_percent=?, primary_resets_at=?, primary_window_minutes=?,
        secondary_used_percent=?, secondary_resets_at=?, secondary_window_minutes=?,
        last_limits_refresh_at=?, updated_at=?
      WHERE id=?
    `).run(
      limits.primary?.usedPercent ?? null,
      limits.primary?.resetsAt ?? null,
      limits.primary?.windowDurationMins ?? null,
      limits.secondary?.usedPercent ?? null,
      limits.secondary?.resetsAt ?? null,
      limits.secondary?.windowDurationMins ?? null,
      limits.loadedAt,
      Date.now(),
      id,
    );
  }

  markAuthRefreshed(id: string): void {
    this.raw.prepare("UPDATE accounts SET auth_status='ready', last_auth_refresh_at=?, updated_at=? WHERE id=?").run(Date.now(), Date.now(), id);
  }

  markAccountUsed(id: string): void {
    this.raw.prepare("UPDATE accounts SET last_used_at=?, updated_at=? WHERE id=?").run(Date.now(), Date.now(), id);
  }

  deleteAccount(id: string): void {
    const inUse = this.raw.prepare("SELECT 1 FROM session_bindings WHERE account_id=? AND status='active' LIMIT 1").get(id);
    if (inUse) throw new Error("account_has_active_sessions");
    this.raw.transaction(() => {
      this.raw.prepare("DELETE FROM session_bindings WHERE account_id=? AND status!='active'").run(id);
      this.raw.prepare("DELETE FROM accounts WHERE id=?").run(id);
    })();
  }

  resolveBinding(identity: RoutingIdentity, transport: Transport, account: AccountRecord): AccountRecord {
    const existing = this.raw.prepare("SELECT account_id FROM session_bindings WHERE routing_key=?").get(identity.routingKey) as { account_id: string } | undefined;
    if (existing) {
      this.raw.prepare("UPDATE session_bindings SET last_seen_at=?, status='active' WHERE routing_key=?").run(Date.now(), identity.routingKey);
      const bound = this.getAccount(existing.account_id);
      if (!bound) throw new Error("bound_account_missing");
      return bound;
    }
    const now = Date.now();
    this.raw.prepare(`
      INSERT INTO session_bindings(routing_key, account_id, thread_id, session_id, transport, status, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(identity.routingKey, account.id, identity.threadId, identity.sessionId, transport, now, now);
    return account;
  }

  bindAlias(identity: RoutingIdentity, transport: Transport, accountId: string): void {
    const now = Date.now();
    this.raw.prepare(`
      INSERT INTO session_bindings(routing_key, account_id, thread_id, session_id, transport, status, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(routing_key) DO UPDATE SET last_seen_at=excluded.last_seen_at
    `).run(identity.routingKey, accountId, identity.threadId, identity.sessionId, transport, now, now);
    const row = this.raw.prepare("SELECT account_id FROM session_bindings WHERE routing_key=?").get(identity.routingKey) as { account_id: string };
    if (row.account_id !== accountId) throw new Error("session_already_bound_to_different_account");
  }

  beginActivity(routingKey: string): () => void {
    this.activeRequests.set(routingKey, (this.activeRequests.get(routingKey) ?? 0) + 1);
    return () => {
      const next = (this.activeRequests.get(routingKey) ?? 1) - 1;
      if (next <= 0) this.activeRequests.delete(routingKey);
      else this.activeRequests.set(routingKey, next);
    };
  }

  listSessions(): SessionRecord[] {
    const rows = this.raw.prepare(`
      SELECT s.*, a.label AS account_label FROM session_bindings s
      JOIN accounts a ON a.id=s.account_id ORDER BY s.last_seen_at DESC
    `).all() as Record<string, unknown>[];
    return rows.map((row) => ({
      routingKey: String(row.routing_key),
      routingKeyHash: createHash("sha256").update(String(row.routing_key)).digest("hex").slice(0, 16),
      accountId: String(row.account_id),
      accountLabel: String(row.account_label),
      threadId: row.thread_id == null ? null : String(row.thread_id),
      sessionId: row.session_id == null ? null : String(row.session_id),
      transport: String(row.transport) as Transport,
      status: String(row.status) as SessionRecord["status"],
      createdAt: Number(row.created_at),
      lastSeenAt: Number(row.last_seen_at),
      expiresAt: row.expires_at == null ? null : Number(row.expires_at),
      activeRequests: this.activeRequests.get(String(row.routing_key)) ?? 0,
    }));
  }

  releaseSession(routingKey: string): void {
    if ((this.activeRequests.get(routingKey) ?? 0) > 0) throw new Error("session_is_active");
    const result = this.raw.prepare("UPDATE session_bindings SET status='closed', last_seen_at=? WHERE routing_key=?").run(Date.now(), routingKey);
    if (result.changes === 0) throw new Error("session_not_found");
  }

  getSettings(): Record<string, unknown> {
    const rows = this.raw.prepare("SELECT key, value_json FROM settings").all() as { key: string; value_json: string }[];
    return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value_json)]));
  }

  updateSettings(values: Record<string, unknown>): Record<string, unknown> {
    const allowed = new Set(["requestMetadataLogging", "theme"]);
    const statement = this.raw.prepare("INSERT INTO settings(key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json");
    this.raw.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        if (!allowed.has(key)) throw new Error("unsupported_setting");
        if (key === "requestMetadataLogging" && typeof value !== "boolean") throw new Error("invalid_setting");
        if (key === "theme" && !["system", "light", "dark"].includes(String(value))) throw new Error("invalid_setting");
        statement.run(key, JSON.stringify(value));
      }
    })();
    return this.getSettings();
  }

  logRequest(input: {
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
  }): void {
    if (this.getSettings().requestMetadataLogging !== true) return;
    this.raw.prepare(`
      INSERT INTO request_log(id, request_id, route, transport, account_id, routing_key_hash, status_code, duration_ms, bytes_in, bytes_out, error_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), input.requestId ?? null, input.route, input.transport, input.accountId ?? null,
      input.routingKey ? createHash("sha256").update(input.routingKey).digest("hex").slice(0, 16) : null,
      input.statusCode ?? null, input.durationMs ?? null, input.bytesIn ?? null, input.bytesOut ?? null,
      input.errorCode ?? null, Date.now(),
    );
  }

  getStats(startedAt: number): Record<string, number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const row = this.raw.prepare(`
      SELECT COUNT(*) AS requests,
      SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errors
      FROM request_log WHERE created_at >= ?
    `).get(today.getTime()) as { requests: number; errors: number };
    return {
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      activeSessions: this.listSessions().filter((session) => session.status === "active").length,
      activeWebSockets: this.listSessions().filter((session) => session.transport === "ws" && session.activeRequests > 0).length,
      requestsToday: row.requests ?? 0,
      errorsToday: row.errors ?? 0,
      accountsReady: this.listAccounts().filter((account) => account.enabled && account.authStatus === "ready").length,
    };
  }
}
