import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, stat, truncate, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

type LogLike = { warn(values: Record<string, unknown>, message: string): void };
type AuditEvent = "baseline" | "source_missing" | "source_restored" | "source_changed" | "backup_created" | "database_recovered";

const USAGE_SCHEMA_VERSION = 2;
const EMPTY_HASH = "0".repeat(64);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS codex_usage_source (
  source_hash TEXT PRIMARY KEY,
  baseline_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_successful_scan_at INTEGER,
  scan_generation INTEGER NOT NULL DEFAULT 0,
  discovered_rollouts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS codex_usage_rollout (
  thread_id TEXT PRIMARY KEY,
  source_hash TEXT NOT NULL,
  source_category TEXT NOT NULL,
  encoding TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  next_ordinal INTEGER NOT NULL DEFAULT 0,
  session_started_at INTEGER,
  last_event_at INTEGER,
  project_key TEXT,
  project_label TEXT,
  latest_model TEXT,
  previous_input_tokens INTEGER,
  previous_cached_input_tokens INTEGER,
  previous_output_tokens INTEGER,
  previous_reasoning_output_tokens INTEGER,
  warning_count INTEGER NOT NULL DEFAULT 0,
  last_scanned_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS codex_usage_event (
  thread_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  model TEXT,
  project_key TEXT,
  project_label TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(thread_id, ordinal),
  FOREIGN KEY(thread_id) REFERENCES codex_usage_rollout(thread_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS codex_usage_retained_rollout (
  source_hash TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  source_category TEXT NOT NULL,
  session_started_at INTEGER,
  last_event_at INTEGER,
  project_key TEXT,
  project_label TEXT,
  latest_model TEXT,
  warning_count INTEGER NOT NULL DEFAULT 0,
  last_scanned_at INTEGER NOT NULL,
  missing_at INTEGER NOT NULL,
  restored_at INTEGER,
  PRIMARY KEY(source_hash, thread_id)
);
CREATE TABLE IF NOT EXISTS codex_usage_retained_event (
  source_hash TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  model TEXT,
  project_key TEXT,
  project_label TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(source_hash, thread_id, ordinal),
  FOREIGN KEY(source_hash, thread_id) REFERENCES codex_usage_retained_rollout(source_hash, thread_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS codex_usage_missing_candidate (
  source_hash TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  first_missing_at INTEGER NOT NULL,
  last_missing_at INTEGER NOT NULL,
  confirmations INTEGER NOT NULL,
  first_scan_generation INTEGER NOT NULL,
  PRIMARY KEY(source_hash, thread_id)
);
CREATE TABLE IF NOT EXISTS codex_usage_scan_batch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_hash TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  complete INTEGER NOT NULL,
  warnings INTEGER NOT NULL,
  discovered_rollouts INTEGER NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS codex_usage_audit_event (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL,
  event TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  previous_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE,
  exported_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_codex_usage_event_time ON codex_usage_event(occurred_at);
CREATE INDEX IF NOT EXISTS idx_codex_usage_retained_event_source_time ON codex_usage_retained_event(source_hash, occurred_at);
`;

function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
function integrityOk(db: Database.Database): boolean {
  return (db.pragma("integrity_check", { simple: true }) as string) === "ok";
}

interface SnapshotManifest {
  version: 1; file: string; createdAt: number; sha256: string;
  rollouts: number; events: number; totalTokens: number;
}

export interface UsageStoreStatus {
  pendingAuditEvents: number;
  lastVerifiedAt: number | null;
  backup: { status: "ready" | "pending" | "failed" | "unavailable"; lastSuccessfulAt: number | null; generations: number; lastRecoveryAt: number | null };
}

export class CodexUsageStore {
  readonly raw: Database.Database;
  readonly databasePath: string;
  readonly auditPath: string;
  readonly backupDir: string;
  private readonly secret: Buffer;
  private auditPrepared = false;
  private auditFlush: Promise<void> | null = null;
  private backupStatus: UsageStoreStatus["backup"] = { status: "unavailable", lastSuccessfulAt: null, generations: 0, lastRecoveryAt: null };
  private lastVerifiedAt: number | null = null;

  private constructor(databasePath: string, auditPath: string, backupDir: string, raw: Database.Database, secret: Buffer, private readonly log: LogLike) {
    this.databasePath = databasePath;
    this.auditPath = auditPath;
    this.backupDir = backupDir;
    this.raw = raw;
    this.secret = secret;
  }

  static async open(dataDir: string, legacyDb: Database.Database, log: LogLike): Promise<CodexUsageStore> {
    const databasePath = path.join(dataDir, "codex-usage.db");
    const auditPath = path.join(dataDir, "logs", "codex-usage-retention.jsonl");
    const backupDir = path.join(dataDir, "backups", "codex-usage");
    await Promise.all([mkdir(path.dirname(auditPath), { recursive: true }), mkdir(backupDir, { recursive: true })]);
    const recovery = await this.recoverIfNeeded(databasePath, backupDir, log);
    const raw = new Database(databasePath);
    raw.pragma("journal_mode = WAL"); raw.pragma("foreign_keys = ON"); raw.pragma("busy_timeout = 5000");
    raw.exec("CREATE TABLE IF NOT EXISTS usage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const storedVersion = Number((raw.prepare("SELECT value FROM usage_meta WHERE key='schema_version'").get() as { value: string } | undefined)?.value ?? 0);
    if (storedVersion > 0 && storedVersion < USAGE_SCHEMA_VERSION) await this.backupBeforeMigration(raw, backupDir);
    raw.exec(SCHEMA);
    const auditColumns = raw.pragma("table_info(codex_usage_audit_event)") as Array<{ name: string }>;
    if (!auditColumns.some((column) => column.name === "version")) raw.exec("ALTER TABLE codex_usage_audit_event ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
    raw.prepare("INSERT OR REPLACE INTO usage_meta(key,value) VALUES('schema_version',?)").run(String(USAGE_SCHEMA_VERSION));
    let secretHex = (raw.prepare("SELECT value FROM usage_meta WHERE key='hmac_secret'").get() as { value: string } | undefined)?.value;
    if (!secretHex) { secretHex = randomBytes(32).toString("hex"); raw.prepare("INSERT INTO usage_meta(key,value) VALUES('hmac_secret',?)").run(secretHex); }
    const store = new CodexUsageStore(databasePath, auditPath, backupDir, raw, Buffer.from(secretHex, "hex"), log);
    store.backupStatus.lastRecoveryAt = recovery.recoveredAt;
    await store.importLegacy(legacyDb);
    if (recovery.recoveredAt) store.transaction(() => store.recordAudit("database_recovered", { recoveredAt: recovery.recoveredAt, snapshot: recovery.snapshot ?? null }));
    await store.refreshBackupStatus();
    await store.flushAudit();
    return store;
  }

  private static async backupBeforeMigration(raw: Database.Database, backupDir: string): Promise<void> {
    const createdAt = Date.now(); const stamp = new Date(createdAt).toISOString().replaceAll(":", "-");
    const file = `codex-usage-pre-migration-${stamp}.db`; const target = path.join(backupDir, file); const temporary = `${target}.tmp`;
    await raw.backup(temporary);
    const verify = new Database(temporary, { readonly: true, fileMustExist: true });
    if (!integrityOk(verify)) { verify.close(); await unlink(temporary).catch(() => undefined); throw new Error("pre_migration_snapshot_integrity_failed"); }
    const rollouts = tableExists(verify, "codex_usage_rollout") ? (verify.prepare("SELECT (SELECT COUNT(*) FROM codex_usage_rollout)+(SELECT COUNT(*) FROM codex_usage_retained_rollout) AS count").get() as { count: number }).count : 0;
    const events = tableExists(verify, "codex_usage_event") ? (verify.prepare("SELECT (SELECT COUNT(*) FROM codex_usage_event)+(SELECT COUNT(*) FROM codex_usage_retained_event) AS count").get() as { count: number }).count : 0;
    const totalTokens = tableExists(verify, "codex_usage_event") ? (verify.prepare("SELECT COALESCE((SELECT SUM(total_tokens) FROM codex_usage_event),0)+COALESCE((SELECT SUM(total_tokens) FROM codex_usage_retained_event),0) AS total").get() as { total: number }).total : 0;
    verify.close(); await rename(temporary, target);
    const manifest: SnapshotManifest = { version: 1, file, createdAt, sha256: sha256(await readFile(target)), rollouts, events, totalTokens };
    await writeFile(`${target}.manifest.json.tmp`, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(`${target}.manifest.json.tmp`, `${target}.manifest.json`);
  }

  private static async recoverIfNeeded(databasePath: string, backupDir: string, log: LogLike): Promise<{ recoveredAt: number | null; snapshot?: string }> {
    let databaseExists = true;
    try {
      const db = new Database(databasePath, { readonly: true, fileMustExist: true });
      const ok = integrityOk(db); db.close();
      if (ok) return { recoveredAt: null };
    } catch (error) {
      try { await stat(databasePath); } catch { databaseExists = false; }
      if (databaseExists) log.warn({ error: error instanceof Error ? error.name : "unknown" }, "Codex usage database failed integrity verification");
    }
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    if (databaseExists) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try { await rename(`${databasePath}${suffix}`, `${databasePath}.corrupt-${timestamp}${suffix}`); } catch { /* file may not exist */ }
      }
    }
    const entries: SnapshotManifest[] = [];
    for (const name of (await readdir(backupDir).catch(() => [])).filter((item) => item.endsWith(".manifest.json"))) {
      try { entries.push(JSON.parse(await readFile(path.join(backupDir, name), "utf8")) as SnapshotManifest); } catch { /* ignore malformed manifests */ }
    }
    entries.sort((a, b) => b.createdAt - a.createdAt);
    for (const manifest of entries) {
      try {
        const snapshotPath = path.join(backupDir, manifest.file);
        if (sha256(await readFile(snapshotPath)) !== manifest.sha256) continue;
        const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
        const rollouts = (snapshot.prepare("SELECT (SELECT COUNT(*) FROM codex_usage_rollout)+(SELECT COUNT(*) FROM codex_usage_retained_rollout) AS count").get() as { count: number }).count;
        const events = (snapshot.prepare("SELECT (SELECT COUNT(*) FROM codex_usage_event)+(SELECT COUNT(*) FROM codex_usage_retained_event) AS count").get() as { count: number }).count;
        const totalTokens = (snapshot.prepare("SELECT COALESCE((SELECT SUM(total_tokens) FROM codex_usage_event),0)+COALESCE((SELECT SUM(total_tokens) FROM codex_usage_retained_event),0) AS total").get() as { total: number }).total;
        const ok = integrityOk(snapshot) && rollouts === manifest.rollouts && events === manifest.events && totalTokens === manifest.totalTokens;
        snapshot.close();
        if (!ok) continue;
        const temporary = `${databasePath}.restore.tmp`; await copyFile(snapshotPath, temporary); await rename(temporary, databasePath);
        return { recoveredAt: Date.now(), snapshot: manifest.file };
      } catch { /* try an older generation */ }
    }
    return { recoveredAt: databaseExists || entries.length > 0 ? Date.now() : null };
  }

  private meta(key: string): string | null { return (this.raw.prepare("SELECT value FROM usage_meta WHERE key=?").get(key) as { value: string } | undefined)?.value ?? null; }
  setMeta(key: string, value: string): void { this.raw.prepare("INSERT OR REPLACE INTO usage_meta(key,value) VALUES(?,?)").run(key, value); }
  sourceKey(root: string): string { return createHmac("sha256", this.secret).update(`source:${path.resolve(root).toLocaleLowerCase()}`).digest("hex"); }
  threadKey(sourceHash: string, rawThreadId: string): string { return createHmac("sha256", this.secret).update(`thread:${sourceHash}:${rawThreadId.toLocaleLowerCase()}`).digest("hex"); }
  currentSource(): string | null { return this.meta("current_source_hash"); }
  transaction<T>(fn: () => T): T { return this.raw.transaction(fn)(); }

  private async importLegacy(legacyDb: Database.Database): Promise<void> {
    if (this.meta("legacy_import_complete")) return;
    const currentRoot = (await import("./codex-config.js")).codexHomeDir();
    const legacyCurrentSource = sha256(path.resolve(currentRoot).toLocaleLowerCase());
    const sourceMap = new Map<string, string>();
    const mapSource = (source: string) => {
      let mapped = sourceMap.get(source);
      if (!mapped) { mapped = source === legacyCurrentSource ? this.sourceKey(currentRoot) : createHmac("sha256", this.secret).update(`legacy-source:${source}`).digest("hex"); sourceMap.set(source, mapped); }
      return mapped;
    };
    if (!tableExists(legacyDb, "codex_usage_rollout")) { this.setMeta("legacy_import_complete", String(Date.now())); return; }
    const legacyRollouts = (legacyDb.prepare(`SELECT
      (SELECT COUNT(*) FROM codex_usage_rollout) +
      ${tableExists(legacyDb, "codex_usage_retained_rollout") ? "(SELECT COUNT(*) FROM codex_usage_retained_rollout)" : "0"} AS count`).get() as { count: number }).count;
    const legacyEvents = (legacyDb.prepare(`SELECT
      (SELECT COUNT(*) FROM codex_usage_event) +
      ${tableExists(legacyDb, "codex_usage_retained_event") ? "(SELECT COUNT(*) FROM codex_usage_retained_event)" : "0"} AS count,
      COALESCE((SELECT SUM(total_tokens) FROM codex_usage_event),0) +
      ${tableExists(legacyDb, "codex_usage_retained_event") ? "COALESCE((SELECT SUM(total_tokens) FROM codex_usage_retained_event),0)" : "0"} AS total`).get() as { count: number; total: number });
    this.transaction(() => {
      const threadMap = new Map<string, { source: string; thread: string }>();
      const insertRollout = this.raw.prepare(`INSERT OR IGNORE INTO codex_usage_rollout VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const row of legacyDb.prepare("SELECT * FROM codex_usage_rollout").all() as Array<Record<string, unknown>>) {
        const source = mapSource(String(row.source_hash)); const thread = this.threadKey(source, String(row.thread_id)); threadMap.set(String(row.thread_id), { source, thread });
        insertRollout.run(thread, source, String(row.relative_path).replaceAll("\\", "/").startsWith("archived_sessions/") ? "archived_sessions" : "sessions", row.encoding, row.file_size, row.mtime_ms, row.byte_offset, row.next_ordinal, row.session_started_at, row.last_event_at, row.project_key, row.project_label, row.latest_model, row.previous_input_tokens, row.previous_cached_input_tokens, row.previous_output_tokens, row.previous_reasoning_output_tokens, row.warning_count, row.last_scanned_at);
      }
      if (tableExists(legacyDb, "codex_usage_event")) {
        const insertEvent = this.raw.prepare("INSERT OR IGNORE INTO codex_usage_event VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
        for (const row of legacyDb.prepare("SELECT * FROM codex_usage_event").all() as Array<Record<string, unknown>>) { const mapped = threadMap.get(String(row.thread_id)); if (mapped) insertEvent.run(mapped.thread, row.ordinal, row.occurred_at, row.kind, row.model, row.project_key, row.project_label, row.input_tokens, row.cached_input_tokens, row.output_tokens, row.reasoning_output_tokens, row.total_tokens); }
      }
      if (tableExists(legacyDb, "codex_usage_retained_rollout")) {
        const insertRetained = this.raw.prepare("INSERT OR IGNORE INTO codex_usage_retained_rollout VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
        const retainedMap = new Map<string, { source: string; thread: string }>();
        for (const row of legacyDb.prepare("SELECT * FROM codex_usage_retained_rollout").all() as Array<Record<string, unknown>>) { const source = mapSource(String(row.source_hash)); const thread = this.threadKey(source, String(row.thread_id)); retainedMap.set(`${row.source_hash}:${row.thread_id}`, { source, thread }); insertRetained.run(source, thread, row.source_category, row.session_started_at, row.last_event_at, row.project_key, row.project_label, row.latest_model, row.warning_count, row.last_scanned_at, row.missing_at, row.restored_at); }
        if (tableExists(legacyDb, "codex_usage_retained_event")) { const insertEvent = this.raw.prepare("INSERT OR IGNORE INTO codex_usage_retained_event VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"); for (const row of legacyDb.prepare("SELECT * FROM codex_usage_retained_event").all() as Array<Record<string, unknown>>) { const mapped = retainedMap.get(`${row.source_hash}:${row.thread_id}`); if (mapped) insertEvent.run(mapped.source, mapped.thread, row.ordinal, row.occurred_at, row.kind, row.model, row.project_key, row.project_label, row.input_tokens, row.cached_input_tokens, row.output_tokens, row.reasoning_output_tokens, row.total_tokens); } }
      }
      for (const source of sourceMap.values()) this.raw.prepare("INSERT OR IGNORE INTO codex_usage_source VALUES (?,?,?,NULL,0,0)").run(source, null, Date.now());
      if (sourceMap.has(legacyCurrentSource)) this.setMeta("current_source_hash", sourceMap.get(legacyCurrentSource)!);
      const importedRollouts = (this.raw.prepare("SELECT (SELECT COUNT(*) FROM codex_usage_rollout)+(SELECT COUNT(*) FROM codex_usage_retained_rollout) AS count").get() as { count: number }).count;
      const importedEvents = this.raw.prepare(`SELECT
        (SELECT COUNT(*) FROM codex_usage_event)+(SELECT COUNT(*) FROM codex_usage_retained_event) AS count,
        COALESCE((SELECT SUM(total_tokens) FROM codex_usage_event),0)+COALESCE((SELECT SUM(total_tokens) FROM codex_usage_retained_event),0) AS total`).get() as { count: number; total: number };
      if (importedRollouts !== legacyRollouts || importedEvents.count !== legacyEvents.count || importedEvents.total !== legacyEvents.total) {
        throw new Error("codex_usage_legacy_import_validation_failed");
      }
      this.setMeta("legacy_import_complete", String(Date.now()));
    });
  }

  recordAudit(event: AuditEvent, payload: Record<string, unknown>): void {
    const occurredAt = Date.now(); const eventId = randomUUID();
    const previousHash = (this.raw.prepare("SELECT event_hash AS hash FROM codex_usage_audit_event ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined)?.hash ?? EMPTY_HASH;
    const payloadJson = canonicalJson(payload);
    const eventHash = sha256(`${previousHash}\n${eventId}\n${occurredAt}\n${event}\n${payloadJson}`);
    this.raw.prepare("INSERT INTO codex_usage_audit_event(event_id,version,occurred_at,event,payload_json,previous_hash,event_hash) VALUES(?,1,?,?,?,?,?)").run(eventId, occurredAt, event, payloadJson, previousHash, eventHash);
  }

  flushAudit(): Promise<void> {
    if (this.auditFlush) return this.auditFlush;
    this.auditFlush = this.flushAuditInternal().finally(() => { this.auditFlush = null; });
    return this.auditFlush;
  }

  private auditLine(row: Record<string, unknown>): string {
    return `${JSON.stringify({ version: row.version, seq: row.seq, eventId: row.event_id, timestamp: new Date(Number(row.occurred_at)).toISOString(), event: row.event, ...JSON.parse(String(row.payload_json)), previousHash: row.previous_hash, eventHash: row.event_hash })}\n`;
  }

  private async prepareAudit(): Promise<void> {
    if (this.auditPrepared) return;
    let valid = true; let lines: string[] = [];
    try {
      const content = await readFile(this.auditPath);
      const lastNewline = content.lastIndexOf(10);
      if (lastNewline < content.length - 1) await truncate(this.auditPath, Math.max(0, lastNewline + 1));
      lines = content.subarray(0, Math.max(0, lastNewline + 1)).toString("utf8").split("\n").filter(Boolean);
      const rows = this.raw.prepare("SELECT seq,event_hash FROM codex_usage_audit_event ORDER BY seq LIMIT ?").all(lines.length) as Array<{ seq: number; event_hash: string }>;
      let previousHash = EMPTY_HASH;
      valid = rows.length === lines.length && lines.every((line, index) => {
        try {
          const item = JSON.parse(line) as Record<string, unknown>;
          const payload = { ...item };
          for (const key of ["version", "seq", "eventId", "timestamp", "event", "previousHash", "eventHash"]) delete payload[key];
          const occurredAt = Date.parse(String(item.timestamp));
          const expectedHash = sha256(`${previousHash}\n${String(item.eventId)}\n${occurredAt}\n${String(item.event)}\n${canonicalJson(payload)}`);
          const matches = item.version === 1 && item.seq === rows[index].seq && item.previousHash === previousHash && item.eventHash === expectedHash && item.eventHash === rows[index].event_hash;
          previousHash = String(item.eventHash);
          return matches;
        } catch { return false; }
      });
    } catch { lines = []; }
    if (!valid) {
      try { await rename(this.auditPath, `${this.auditPath}.corrupt-${new Date().toISOString().replaceAll(":", "-")}`); } catch { /* absent */ }
      this.raw.prepare("UPDATE codex_usage_audit_event SET exported_at=NULL").run(); lines = [];
    } else if (lines.length) this.raw.prepare("UPDATE codex_usage_audit_event SET exported_at=COALESCE(exported_at,?) WHERE seq<=?").run(Date.now(), lines.length);
    this.auditPrepared = true; this.lastVerifiedAt = Date.now();
  }

  private async flushAuditInternal(): Promise<void> {
    try {
      await this.prepareAudit(); await mkdir(path.dirname(this.auditPath), { recursive: true });
      const pending = this.raw.prepare("SELECT * FROM codex_usage_audit_event WHERE exported_at IS NULL ORDER BY seq").all() as Array<Record<string, unknown>>;
      if (!pending.length) return;
      const handle = await open(this.auditPath, "a", 0o600);
      try { for (const row of pending) await handle.write(this.auditLine(row)); await handle.sync(); } finally { await handle.close(); }
      this.raw.prepare("UPDATE codex_usage_audit_event SET exported_at=? WHERE exported_at IS NULL AND seq<=?").run(Date.now(), pending.at(-1)!.seq);
      this.lastVerifiedAt = Date.now();
    } catch (error) { this.log.warn({ error: error instanceof Error ? error.name : "unknown" }, "Codex usage retention audit could not be synchronized"); }
  }

  async createBackup(reason: "daily" | "retention" | "source_changed" | "migration" = "daily"): Promise<void> {
    this.backupStatus.status = "pending";
    const createdAt = Date.now(); const stamp = new Date(createdAt).toISOString().replaceAll(":", "-");
    const file = `codex-usage-${stamp}.db`; const target = path.join(this.backupDir, file); const temporary = `${target}.tmp`;
    try {
      await this.raw.backup(temporary);
      const verify = new Database(temporary, { readonly: true, fileMustExist: true });
      if (!integrityOk(verify)) { verify.close(); throw new Error("snapshot_integrity_failed"); }
      const rollouts = (verify.prepare("SELECT (SELECT COUNT(*) FROM codex_usage_rollout)+(SELECT COUNT(*) FROM codex_usage_retained_rollout) AS count").get() as { count: number }).count;
      const events = (verify.prepare("SELECT (SELECT COUNT(*) FROM codex_usage_event)+(SELECT COUNT(*) FROM codex_usage_retained_event) AS count").get() as { count: number }).count;
      const totalTokens = (verify.prepare("SELECT COALESCE((SELECT SUM(total_tokens) FROM codex_usage_event),0)+COALESCE((SELECT SUM(total_tokens) FROM codex_usage_retained_event),0) AS total").get() as { total: number }).total; verify.close();
      await rename(temporary, target); const manifest: SnapshotManifest = { version: 1, file, createdAt, sha256: sha256(await readFile(target)), rollouts, events, totalTokens };
      await writeFile(`${target}.manifest.json.tmp`, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", mode: 0o600 }); await rename(`${target}.manifest.json.tmp`, `${target}.manifest.json`);
      this.transaction(() => { this.setMeta("last_backup_at", String(createdAt)); this.recordAudit("backup_created", { reason, createdAt, rollouts, events, totalTokens }); });
      await this.pruneBackups(); await this.refreshBackupStatus(); await this.flushAudit();
    } catch (error) { try { await unlink(temporary); } catch { /* absent */ } this.backupStatus.status = "failed"; this.log.warn({ error: error instanceof Error ? error.name : "unknown" }, "Codex usage snapshot could not be created"); }
  }

  private async pruneBackups(): Promise<void> {
    const manifests: Array<{ name: string; value: SnapshotManifest }> = [];
    for (const name of (await readdir(this.backupDir)).filter((item) => item.endsWith(".manifest.json"))) { try { manifests.push({ name, value: JSON.parse(await readFile(path.join(this.backupDir, name), "utf8")) as SnapshotManifest }); } catch { /* leave unknown files untouched */ } }
    manifests.sort((a, b) => b.value.createdAt - a.value.createdAt);
    const keep = new Set<string>(); const days = new Set<string>(); const weeks = new Set<string>();
    for (const item of manifests) {
      const date = new Date(item.value.createdAt); const day = date.toISOString().slice(0, 10); const week = `${date.getUTCFullYear()}-${Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / 604_800_000)}`;
      if (keep.size === 0 || (days.size < 7 && !days.has(day)) || (weeks.size < 4 && !weeks.has(week))) { keep.add(item.name); days.add(day); weeks.add(week); }
    }
    for (const item of manifests.filter((entry) => !keep.has(entry.name))) { await Promise.allSettled([unlink(path.join(this.backupDir, item.name)), unlink(path.join(this.backupDir, item.value.file))]); }
  }

  private async refreshBackupStatus(): Promise<void> {
    const generations = (await readdir(this.backupDir).catch(() => [])).filter((name) => name.endsWith(".manifest.json")).length;
    const lastSuccessfulAt = Number(this.meta("last_backup_at")) || null;
    this.backupStatus = { ...this.backupStatus, status: generations ? "ready" : "unavailable", lastSuccessfulAt, generations };
  }

  status(): UsageStoreStatus {
    const pendingAuditEvents = (this.raw.prepare("SELECT COUNT(*) AS count FROM codex_usage_audit_event WHERE exported_at IS NULL").get() as { count: number }).count;
    return { pendingAuditEvents, lastVerifiedAt: this.lastVerifiedAt, backup: { ...this.backupStatus } };
  }

  async close(): Promise<void> { await this.auditFlush; this.raw.close(); }
}
