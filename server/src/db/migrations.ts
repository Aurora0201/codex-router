import type Database from "better-sqlite3";

type SqliteDatabase = Database.Database;

export const SCHEMA_VERSION = 9;

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
  chatgpt_account_id TEXT,
  primary_used_percent REAL,
  primary_resets_at INTEGER,
  primary_window_minutes INTEGER,
  secondary_used_percent REAL,
  secondary_resets_at INTEGER,
  secondary_window_minutes INTEGER,
  rate_limit_reached_type TEXT,
  last_auth_refresh_at INTEGER,
  last_limits_refresh_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
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
  status_code INTEGER,
  duration_ms INTEGER,
  bytes_in INTEGER,
  bytes_out INTEGER,
  error_code TEXT,
  outcome TEXT NOT NULL DEFAULT 'upstream_error',
  scope TEXT NOT NULL DEFAULT 'request',
  identity_mode TEXT NOT NULL DEFAULT 'managed_account',
  created_at INTEGER NOT NULL,
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

`;

const V2_STATEMENTS = `
CREATE TABLE IF NOT EXISTS gateway_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  active_account_id TEXT NULL,
  FOREIGN KEY(active_account_id) REFERENCES accounts(id) ON DELETE SET NULL
);
INSERT OR IGNORE INTO gateway_state(singleton, active_account_id) VALUES (1, NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_chatgpt_account_id
ON accounts(chatgpt_account_id) WHERE chatgpt_account_id IS NOT NULL;
`;

function tableColumns(db: SqliteDatabase, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

function currentVersion(db: SqliteDatabase): number {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number | null };
  return row.version ?? 0;
}

export function migrate(db: SqliteDatabase): void {
  db.exec(SCHEMA);
  db.prepare("INSERT OR IGNORE INTO settings(key, value_json) VALUES ('requestMetadataLogging', 'true')").run();
  db.prepare("INSERT OR IGNORE INTO settings(key, value_json) VALUES ('theme', '\"system\"')").run();
  db.prepare("INSERT OR IGNORE INTO settings(key, value_json) VALUES ('logLevel', '\"info\"')").run();

  const version = currentVersion(db);
  if (version < 2) {
    const accountColumns = tableColumns(db, "accounts");
    const adds: string[] = [];
    if (!accountColumns.has("chatgpt_account_id")) adds.push("chatgpt_account_id TEXT");
    if (!accountColumns.has("rate_limit_reached_type")) adds.push("rate_limit_reached_type TEXT");
    for (const column of adds) db.exec(`ALTER TABLE accounts ADD COLUMN ${column}`);
    db.exec(V2_STATEMENTS);
  }
  if (version < 3) {
    const logColumns = tableColumns(db, "request_log");
    if (logColumns.has("routing_key_hash")) db.exec("ALTER TABLE request_log DROP COLUMN routing_key_hash");
    db.exec("DROP TABLE IF EXISTS session_bindings");
  }
  if (version < 4) {
    db.exec(`
      UPDATE accounts SET primary_resets_at = primary_resets_at * 1000
      WHERE primary_resets_at > 0 AND primary_resets_at < 100000000000;
      UPDATE accounts SET secondary_resets_at = secondary_resets_at * 1000
      WHERE secondary_resets_at > 0 AND secondary_resets_at < 100000000000;
    `);
  }
  if (version < 5) {
    const logColumns = tableColumns(db, "request_log");
    if (!logColumns.has("outcome")) db.exec("ALTER TABLE request_log ADD COLUMN outcome TEXT NOT NULL DEFAULT 'upstream_error'");
    if (!logColumns.has("scope")) db.exec("ALTER TABLE request_log ADD COLUMN scope TEXT NOT NULL DEFAULT 'request'");
    db.exec(`
      UPDATE request_log SET scope = 'connection'
      WHERE transport = 'ws'
         OR status_code = 101
         OR error_code LIKE 'client_close_%'
         OR error_code LIKE 'upstream_close_%'
         OR error_code LIKE '%websocket%';

      UPDATE request_log SET outcome = CASE
        WHEN lower(COALESCE(error_code, '')) IN ('this operation was aborted', 'client_cancelled') THEN 'client_cancelled'
        WHEN error_code IN ('no_active_account_selected', 'account_disabled', 'account_not_ready', 'fedramp_accounts_not_supported', 'raw_request_body_unavailable') THEN 'gateway_error'
        WHEN status_code IS NOT NULL AND status_code < 400 THEN 'success'
        WHEN status_code IS NOT NULL AND status_code < 500 THEN 'rejected'
        ELSE 'upstream_error'
      END;
    `);
  }
  if (version < 6) {
    db.exec(`
      UPDATE request_log
      SET outcome = 'client_cancelled', status_code = NULL, error_code = 'client_cancelled'
      WHERE outcome = 'client_cancelled'
         OR lower(COALESCE(error_code, '')) = 'this operation was aborted';
    `);
  }
  if (version < 7) {
    db.exec(`
      UPDATE request_log
      SET outcome = CASE
        WHEN lower(COALESCE(error_code, '')) IN ('this operation was aborted', 'client_cancelled') THEN 'client_cancelled'
        WHEN error_code IN ('no_active_account_selected', 'account_disabled', 'account_not_ready', 'fedramp_accounts_not_supported', 'raw_request_body_unavailable') THEN 'gateway_error'
        WHEN status_code >= 200 AND status_code < 400 THEN 'success'
        WHEN status_code >= 400 AND status_code < 500 THEN 'rejected'
        WHEN status_code >= 500 THEN 'upstream_error'
        ELSE outcome
      END
      WHERE scope = 'request';
    `);
  }
  if (version < 8) {
    const logColumns = tableColumns(db, "request_log");
    if (!logColumns.has("identity_mode")) {
      db.exec("ALTER TABLE request_log ADD COLUMN identity_mode TEXT NOT NULL DEFAULT 'managed_account'");
    }
  }
  if (version < 9) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE request_log_v9 (
          id TEXT PRIMARY KEY,
          request_id TEXT,
          route TEXT NOT NULL,
          transport TEXT NOT NULL,
          account_id TEXT,
          state TEXT NOT NULL,
          outcome TEXT,
          failure_source TEXT,
          failure_stage TEXT,
          http_status INTEGER,
          protocol_error_code TEXT,
          diagnostic_code TEXT,
          upstream_request_id TEXT,
          diagnostic_headers_json TEXT,
          bytes_in INTEGER,
          bytes_out INTEGER,
          identity_mode TEXT NOT NULL DEFAULT 'managed_account',
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
        );
        CREATE TABLE websocket_connection_log (
          id TEXT PRIMARY KEY,
          source_log_id TEXT UNIQUE,
          connection_id TEXT NOT NULL,
          account_id TEXT,
          identity_mode TEXT NOT NULL DEFAULT 'managed_account',
          started_at INTEGER NOT NULL,
          closed_at INTEGER,
          handshake_http_status INTEGER,
          client_close_code INTEGER,
          upstream_close_code INTEGER,
          close_initiator TEXT,
          close_reason_code TEXT,
          outcome TEXT NOT NULL,
          FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
        );
        INSERT INTO request_log_v9 (
          id, request_id, route, transport, account_id, state, outcome,
          http_status, protocol_error_code, diagnostic_code, bytes_in, bytes_out,
          identity_mode, started_at, completed_at
        )
        SELECT id, request_id, route, transport, account_id,
          CASE outcome
            WHEN 'success' THEN 'completed'
            WHEN 'rejected' THEN 'rejected'
            WHEN 'client_cancelled' THEN 'cancelled'
            ELSE 'failed'
          END,
          outcome,
          CASE WHEN transport <> 'ws' THEN status_code END,
          CASE WHEN transport = 'ws' AND scope = 'request' THEN error_code END,
          CASE WHEN transport <> 'ws' THEN error_code END,
          bytes_in, bytes_out, identity_mode, created_at,
          CASE WHEN duration_ms IS NULL THEN created_at ELSE created_at + duration_ms END
        FROM request_log WHERE scope = 'request';
        INSERT OR IGNORE INTO websocket_connection_log (
          id, source_log_id, connection_id, account_id, identity_mode, started_at,
          closed_at, handshake_http_status, close_reason_code, outcome
        )
        SELECT id, id, COALESCE(request_id, id), account_id, identity_mode, created_at,
          CASE WHEN duration_ms IS NULL THEN created_at ELSE created_at + duration_ms END,
          status_code, error_code,
          CASE
            WHEN error_code = 'account_switch_connection_retired' THEN 'retired'
            WHEN status_code = 101 THEN 'closed'
            WHEN status_code IS NOT NULL AND status_code < 500 THEN 'rejected'
            ELSE 'failed'
          END
        FROM request_log WHERE scope = 'connection';
        DROP TABLE request_log;
        ALTER TABLE request_log_v9 RENAME TO request_log;
        CREATE INDEX idx_request_log_started ON request_log(started_at DESC);
        CREATE INDEX idx_websocket_connection_started ON websocket_connection_log(started_at DESC);
      `);
    })();
  }

  db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(SCHEMA_VERSION, Date.now());
}
