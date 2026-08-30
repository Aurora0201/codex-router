import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { createZstdDecompress } from "node:zlib";
import type Database from "better-sqlite3";
import { codexHomeDir } from "./codex-config.js";
import { CodexUsageStore } from "./codex-usage-store.js";

export type CodexUsageRange = "1d" | "7d" | "14d" | "30d" | "90d" | "all";
export interface CodexUsageFilters { range: CodexUsageRange; model?: string; project?: string }
export interface CodexUsageEvent {
  occurredAt: number; kind: "token_usage" | "task_started" | "task_completed" | "turn_aborted" | "context_compacted";
  model: string | null; projectKey: string | null; projectLabel: string | null;
  inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningOutputTokens: number; totalTokens: number;
}

interface RolloutState {
  threadId: string; sourceHash: string; sourceCategory: "sessions" | "archived_sessions"; encoding: string; fileSize: number; mtimeMs: number;
  byteOffset: number; nextOrdinal: number; sessionStartedAt: number | null; lastEventAt: number | null;
  projectKey: string | null; projectLabel: string | null; latestModel: string | null;
  previousInputTokens: number | null; previousCachedInputTokens: number | null; previousOutputTokens: number | null;
  previousReasoningOutputTokens: number | null; warningCount: number; lastScannedAt: number;
}

interface SourceFile { absolutePath: string; sourceCategory: "sessions" | "archived_sessions"; rawThreadId: string; threadId: string; encoding: "jsonl" | "zstd"; size: number; mtimeMs: number }
interface DiscoveryResult { files: SourceFile[]; complete: boolean; warnings: number }
type ChangeHandler = () => void;
type LogLike = { warn(values: Record<string, unknown>, message: string): void };

export const UNCATEGORIZED_PROJECT_KEY = "uncategorized-conversation";
export const UNCATEGORIZED_PROJECT_LABEL = "无分类对话";

const ROLLOUT_SELECT = `SELECT thread_id AS threadId, source_hash AS sourceHash, source_category AS sourceCategory,
  encoding, file_size AS fileSize, mtime_ms AS mtimeMs, byte_offset AS byteOffset, next_ordinal AS nextOrdinal,
  session_started_at AS sessionStartedAt, last_event_at AS lastEventAt, project_key AS projectKey,
  project_label AS projectLabel, latest_model AS latestModel, previous_input_tokens AS previousInputTokens,
  previous_cached_input_tokens AS previousCachedInputTokens, previous_output_tokens AS previousOutputTokens,
  previous_reasoning_output_tokens AS previousReasoningOutputTokens, warning_count AS warningCount,
  last_scanned_at AS lastScannedAt FROM codex_usage_rollout`;

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function safeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
function projectIdentity(cwd: unknown): { key: string; label: string } | null {
  if (typeof cwd !== "string" || cwd.length === 0) return null;
  const normalized = path.normalize(cwd).replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  const [codexDirectory, dateDirectory, conversationDirectory] = parts.slice(-3);
  if (/^codex$/i.test(codexDirectory ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(dateDirectory ?? "") && conversationDirectory) {
    return { key: UNCATEGORIZED_PROJECT_KEY, label: UNCATEGORIZED_PROJECT_LABEL };
  }
  return { key: hash(normalized.toLocaleLowerCase()), label: parts.slice(-2).join("/") || "未知项目" };
}
type ProjectRankRow = { key: string; label: string; totalTokens: number; tasks: number; share: number };
function limitProjectRows(allProjects: ProjectRankRow[]): ProjectRankRow[] {
  let visibleProjects = allProjects.slice(0, 8);
  const uncategorized = allProjects.find((row) => row.key === UNCATEGORIZED_PROJECT_KEY);
  if (uncategorized && !visibleProjects.includes(uncategorized)) visibleProjects = [...visibleProjects.slice(0, 7), uncategorized];
  const visibleKeys = new Set(visibleProjects.map((row) => row.key));
  const hiddenProjects = allProjects.filter((row) => !visibleKeys.has(row.key));
  return hiddenProjects.length === 0 ? visibleProjects : [...visibleProjects, hiddenProjects.reduce((other, row) => ({ key: "other", label: "其他", totalTokens: other.totalTokens + row.totalTokens, tasks: other.tasks + row.tasks, share: other.share + row.share }), { key: "other", label: "其他", totalTokens: 0, tasks: 0, share: 0 })];
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}
function timestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function threadIdFromName(fileName: string): string | null {
  return fileName.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.jsonl(?:\.zst)?)?$/i)?.[1] ?? null;
}

async function discoverFiles(root: string): Promise<DiscoveryResult> {
  const files: SourceFile[] = [];
  let complete = true; let warnings = 0;
  try { if (!(await stat(root)).isDirectory()) return { files, complete: false, warnings: 1 }; } catch { return { files, complete: false, warnings: 1 }; }
  for (const directory of ["sessions", "archived_sessions"] as const) {
    const base = path.join(root, directory);
    async function walk(current: string, isRoot = false): Promise<void> {
      let handle;
      try { handle = await opendir(current); } catch (error) {
        if (isRoot && (error as NodeJS.ErrnoException).code === "ENOENT") return;
        complete = false; warnings += 1; return;
      }
      try {
        for await (const entry of handle) {
          const absolutePath = path.join(current, entry.name);
          if (entry.isDirectory()) await walk(absolutePath);
          else if (entry.isFile() && (entry.name.endsWith(".jsonl") || entry.name.endsWith(".jsonl.zst"))) {
            const rawThreadId = threadIdFromName(entry.name);
            if (!rawThreadId) continue;
            try {
              const details = await stat(absolutePath);
              files.push({ absolutePath, sourceCategory: directory, rawThreadId, threadId: "",
                encoding: entry.name.endsWith(".zst") ? "zstd" : "jsonl", size: details.size, mtimeMs: Math.trunc(details.mtimeMs) });
            } catch { complete = false; warnings += 1; }
          }
        }
      } catch { complete = false; warnings += 1; }
    }
    await walk(base, true);
  }
  const preferred = new Map<string, SourceFile>();
  const priority = (file: SourceFile) => (file.sourceCategory === "sessions" ? 0 : 2) + (file.encoding === "jsonl" ? 0 : 1);
  for (const file of files.sort((a, b) => priority(a) - priority(b))) {
    if (!preferred.has(file.rawThreadId)) preferred.set(file.rawThreadId, file);
  }
  return { files: [...preferred.values()], complete, warnings };
}

async function* readLines(file: SourceFile, offset: number): AsyncGenerator<{ line: string; nextOffset: number }> {
  const input = createReadStream(file.absolutePath, file.encoding === "jsonl" && offset > 0 ? { start: offset } : undefined);
  if (file.encoding === "jsonl") {
    let cursor = offset;
    let pending = Buffer.alloc(0);
    for await (const chunk of input) {
      pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      let newline = pending.indexOf(10);
      while (newline >= 0) {
        const raw = pending.subarray(0, newline);
        pending = pending.subarray(newline + 1);
        cursor += newline + 1;
        yield { line: raw.subarray(0, raw.at(-1) === 13 ? -1 : undefined).toString("utf8"), nextOffset: cursor };
        newline = pending.indexOf(10);
      }
    }
    return;
  }
  const lines = readline.createInterface({ input: input.pipe(createZstdDecompress()), crlfDelay: Infinity });
  for await (const line of lines) {
    yield { line, nextOffset: file.size };
  }
}

function parseAllowedLine(line: string, state: RolloutState): CodexUsageEvent | null {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(line) as Record<string, unknown>; } catch { state.warningCount += 1; return null; }
  const occurredAt = timestamp(raw.timestamp);
  const payload = asRecord(raw.payload);
  if (raw.type === "session_meta" && payload) {
    const identity = projectIdentity(payload.cwd);
    if (identity) { state.projectKey = identity.key; state.projectLabel = identity.label; }
    state.sessionStartedAt ??= timestamp(payload.timestamp) ?? occurredAt;
    return null;
  }
  if (raw.type === "turn_context" && payload) {
    if (typeof payload.model === "string") state.latestModel = payload.model;
    const identity = projectIdentity(payload.cwd);
    if (identity) { state.projectKey = identity.key; state.projectLabel = identity.label; }
    return null;
  }
  if (raw.type !== "event_msg" || !payload || !occurredAt) return null;
  const base = { occurredAt, model: state.latestModel, projectKey: state.projectKey, projectLabel: state.projectLabel,
    inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
  if (payload.type === "token_count") {
    const info = asRecord(payload.info);
    const totals = asRecord(info?.total_token_usage);
    const last = asRecord(info?.last_token_usage);
    if (!totals && !last) return null;
    const currentInput = safeInteger(totals?.input_tokens);
    const currentCached = safeInteger(totals?.cached_input_tokens);
    const currentOutput = safeInteger(totals?.output_tokens);
    const currentReasoning = safeInteger(totals?.reasoning_output_tokens);
    const inputTokens = state.previousInputTokens === null ? safeInteger(last?.input_tokens ?? totals?.input_tokens) : Math.max(0, currentInput - state.previousInputTokens);
    const cachedInputTokens = state.previousCachedInputTokens === null ? safeInteger(last?.cached_input_tokens ?? totals?.cached_input_tokens) : Math.max(0, currentCached - state.previousCachedInputTokens);
    const outputTokens = state.previousOutputTokens === null ? safeInteger(last?.output_tokens ?? totals?.output_tokens) : Math.max(0, currentOutput - state.previousOutputTokens);
    const reasoningOutputTokens = state.previousReasoningOutputTokens === null ? safeInteger(last?.reasoning_output_tokens ?? totals?.reasoning_output_tokens) : Math.max(0, currentReasoning - state.previousReasoningOutputTokens);
    state.previousInputTokens = currentInput; state.previousCachedInputTokens = currentCached;
    state.previousOutputTokens = currentOutput; state.previousReasoningOutputTokens = currentReasoning;
    if (inputTokens + outputTokens === 0) return null;
    return { ...base, kind: "token_usage", inputTokens, cachedInputTokens: Math.min(inputTokens, cachedInputTokens),
      outputTokens, reasoningOutputTokens: Math.min(outputTokens, reasoningOutputTokens), totalTokens: inputTokens + outputTokens };
  }
  const kinds = { task_started: "task_started", task_complete: "task_completed", turn_aborted: "turn_aborted", context_compacted: "context_compacted" } as const;
  const kind = kinds[payload.type as keyof typeof kinds];
  return kind ? { ...base, kind } : null;
}

export class CodexUsageService {
  private scanning = false;
  private scanTimer: NodeJS.Timeout | null = null;
  private backupTimer: NodeJS.Timeout | null = null;
  private activeScan: Promise<void> | null = null;
  private activeBackup: Promise<void> | null = null;
  private status: "scanning" | "ready" | "partial" = "scanning";
  private currentSourceHash: string | null = null;
  private scanComplete = false;

  private constructor(
    private readonly store: CodexUsageStore,
    private readonly onChange: ChangeHandler,
    private readonly log: LogLike,
    private readonly minimumMissingAgeMs = 30_000,
    private readonly automaticBackups = true,
  ) {}

  static async create(options: {
    dataDir: string; legacyDb: Database.Database; onChange: ChangeHandler; log: LogLike;
    minimumMissingAgeMs?: number; automaticBackups?: boolean;
  }): Promise<CodexUsageService> {
    const store = await CodexUsageStore.open(options.dataDir, options.legacyDb, options.log);
    return new CodexUsageService(store, options.onChange, options.log, options.minimumMissingAgeMs ?? 30_000, options.automaticBackups ?? true);
  }

  get database(): Database.Database { return this.store.raw; }

  start(): void {
    void this.scan();
    this.scanTimer = setInterval(() => void this.scan(), 30_000);
    this.scanTimer.unref();
  }

  async close(): Promise<void> {
    if (this.scanTimer) clearInterval(this.scanTimer);
    if (this.backupTimer) clearTimeout(this.backupTimer);
    this.scanTimer = null; this.backupTimer = null;
    await this.activeScan; await this.activeBackup;
    await this.store.flushAudit();
    await this.store.close();
  }

  scan(): Promise<void> {
    if (this.activeScan) return this.activeScan;
    const running = this.performScan();
    this.activeScan = running.finally(() => { this.activeScan = null; });
    return this.activeScan;
  }

  private scheduleBackup(reason: "daily" | "retention" | "source_changed"): void {
    if (!this.automaticBackups || this.backupTimer || this.activeBackup) return;
    this.backupTimer = setTimeout(() => {
      this.backupTimer = null;
      this.activeBackup = this.store.createBackup(reason).finally(() => { this.activeBackup = null; this.onChange(); });
    }, 1_000);
    this.backupTimer.unref();
  }

  private retainRolloutsInTransaction(states: RolloutState[], auditEvent: "source_missing" | null, scanBatch: number | null = null): void {
    if (!states.length) return;
    const retainedAt = Date.now();
    const upsertRollout = this.store.raw.prepare(`INSERT INTO codex_usage_retained_rollout
      (source_hash,thread_id,source_category,session_started_at,last_event_at,project_key,project_label,latest_model,warning_count,last_scanned_at,missing_at,restored_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)
      ON CONFLICT(source_hash,thread_id) DO UPDATE SET source_category=excluded.source_category,session_started_at=excluded.session_started_at,
      last_event_at=excluded.last_event_at,project_key=excluded.project_key,project_label=excluded.project_label,latest_model=excluded.latest_model,
      warning_count=excluded.warning_count,last_scanned_at=excluded.last_scanned_at,missing_at=excluded.missing_at,restored_at=NULL`);
    const copyEvents = this.store.raw.prepare(`INSERT OR REPLACE INTO codex_usage_retained_event
      SELECT ?,thread_id,ordinal,occurred_at,kind,model,project_key,project_label,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens
      FROM codex_usage_event WHERE thread_id=?`);
    const countEvents = this.store.raw.prepare("SELECT COUNT(*) AS count FROM codex_usage_event WHERE thread_id=?");
    const remove = this.store.raw.prepare("DELETE FROM codex_usage_rollout WHERE thread_id=?");
    for (const state of states) {
      const derivedEventCount = (countEvents.get(state.threadId) as { count: number }).count;
      upsertRollout.run(state.sourceHash, state.threadId, state.sourceCategory, state.sessionStartedAt, state.lastEventAt, state.projectKey, state.projectLabel,
        state.latestModel, state.warningCount, state.lastScannedAt, retainedAt);
      copyEvents.run(state.sourceHash, state.threadId);
      remove.run(state.threadId);
      this.store.raw.prepare("DELETE FROM codex_usage_missing_candidate WHERE source_hash=? AND thread_id=?").run(state.sourceHash, state.threadId);
      if (auditEvent) this.store.recordAudit(auditEvent, {
        sessionHash: state.threadId, sessionStartedAt: state.sessionStartedAt, lastEventAt: state.lastEventAt,
        sourceCategory: state.sourceCategory, derivedEventCount, scanBatch, reason: "unknown", detection: "filesystem_absence",
      });
    }
  }

  private async performScan(): Promise<void> {
    this.scanning = true;
    const previousStatus = this.status; this.status = "scanning";
    let changed = false; let retentionChanged = false; let sourceChanged = false; let scanBatch: number | null = null;
    try {
      const root = codexHomeDir();
      const sourceHash = this.store.sourceKey(root);
      const discovery = await discoverFiles(root);
      this.scanComplete = discovery.complete;
      scanBatch = Number(this.store.raw.prepare(`INSERT INTO codex_usage_scan_batch
        (source_hash,started_at,complete,warnings,discovered_rollouts,status) VALUES (?,?,?,?,?,'scanning')`)
        .run(sourceHash, Date.now(), discovery.complete ? 1 : 0, discovery.warnings, discovery.files.length).lastInsertRowid);
      const persistedSource = this.store.currentSource();
      this.currentSourceHash = persistedSource ?? sourceHash;

      if (!discovery.complete && persistedSource !== sourceHash) {
        this.status = "partial";
        return;
      }

      for (const file of discovery.files) file.threadId = this.store.threadKey(sourceHash, file.rawThreadId);
      if (discovery.complete && persistedSource !== sourceHash) {
        this.store.transaction(() => {
          if (persistedSource) {
            const previous = this.store.raw.prepare(`${ROLLOUT_SELECT} WHERE source_hash=?`).all(persistedSource) as RolloutState[];
            this.retainRolloutsInTransaction(previous, null);
            this.store.recordAudit("source_changed", { previousSourceId: persistedSource, sourceId: sourceHash, retainedRollouts: previous.length, scanBatch });
          }
          this.store.setMeta("current_source_hash", sourceHash);
          this.store.raw.prepare("INSERT OR IGNORE INTO codex_usage_source VALUES (?,?,?,NULL,0,0)").run(sourceHash, null, Date.now());
        });
        this.currentSourceHash = sourceHash; changed = true; sourceChanged = true;
      }

      if (this.currentSourceHash !== sourceHash) { this.status = "partial"; return; }
      this.store.raw.prepare("INSERT OR IGNORE INTO codex_usage_source VALUES (?,?,?,NULL,0,0)").run(sourceHash, null, Date.now());
      const source = this.store.raw.prepare("SELECT baseline_at AS baselineAt,scan_generation AS generation FROM codex_usage_source WHERE source_hash=?").get(sourceHash) as { baselineAt: number | null; generation: number };
      const generation = source.generation + (discovery.complete ? 1 : 0);
      if (source.baselineAt === null && discovery.complete) {
        const hashes = discovery.files.map((file) => file.threadId).sort();
        this.store.transaction(() => {
          this.store.recordAudit("baseline", { sourceId: sourceHash, sourceRollouts: hashes.length, inventoryDigest: hash(hashes.join("\n")), scanBatch });
          this.store.raw.prepare("UPDATE codex_usage_source SET baseline_at=? WHERE source_hash=?").run(Date.now(), sourceHash);
        });
        changed = true;
      }

      const existing = new Map((this.store.raw.prepare(`${ROLLOUT_SELECT} WHERE source_hash=?`).all(sourceHash) as RolloutState[]).map((item) => [item.threadId, item]));
      const retainedMissing = new Set((this.store.raw.prepare("SELECT thread_id AS threadId FROM codex_usage_retained_rollout WHERE source_hash=? AND restored_at IS NULL").all(sourceHash) as Array<{ threadId: string }>).map((item) => item.threadId));
      const seen = new Set<string>();
      let warnings = discovery.warnings;

      for (const file of discovery.files) {
        seen.add(file.threadId);
        const saved = existing.get(file.threadId);
        if (saved && saved.fileSize === file.size && saved.mtimeMs === file.mtimeMs && saved.byteOffset === file.size && saved.encoding === file.encoding) {
          if (saved.sourceCategory !== file.sourceCategory) { this.store.raw.prepare("UPDATE codex_usage_rollout SET source_category=? WHERE thread_id=?").run(file.sourceCategory, file.threadId); changed = true; }
          warnings += saved.warningCount; continue;
        }
        const canAppend = Boolean(saved && file.encoding === "jsonl" && saved.encoding === "jsonl" && file.size > saved.fileSize && saved.byteOffset <= saved.fileSize);
        const state: RolloutState = canAppend ? { ...saved!, sourceCategory: file.sourceCategory, fileSize: file.size, mtimeMs: file.mtimeMs } : {
          threadId: file.threadId, sourceHash, sourceCategory: file.sourceCategory, encoding: file.encoding, fileSize: file.size, mtimeMs: file.mtimeMs,
          byteOffset: 0, nextOrdinal: 0, sessionStartedAt: null, lastEventAt: null, projectKey: null, projectLabel: null,
          latestModel: null, previousInputTokens: null, previousCachedInputTokens: null, previousOutputTokens: null,
          previousReasoningOutputTokens: null, warningCount: 0, lastScannedAt: Date.now(),
        };
        const events: Array<CodexUsageEvent & { ordinal: number }> = [];
        let parseIncomplete = false;
        try {
          for await (const item of readLines(file, canAppend ? state.byteOffset : 0)) {
            state.byteOffset = file.encoding === "jsonl" ? Math.min(item.nextOffset, file.size) : file.size;
            const warningBefore = state.warningCount;
            const event = parseAllowedLine(item.line, state);
            if (state.warningCount > warningBefore) parseIncomplete = true;
            if (event) { events.push({ ...event, ordinal: state.nextOrdinal++ }); state.lastEventAt = event.occurredAt; }
          }
        } catch {
          state.warningCount += 1; parseIncomplete = true;
          this.log.warn({ sessionHash: file.threadId, encoding: file.encoding }, "Codex usage rollout could not be fully scanned");
        }
        state.fileSize = file.size; state.mtimeMs = file.mtimeMs; state.encoding = file.encoding; state.sourceHash = sourceHash; state.lastScannedAt = Date.now();
        if (parseIncomplete && saved) { warnings += state.warningCount; continue; }

        this.store.transaction(() => {
          if (!canAppend) this.store.raw.prepare("DELETE FROM codex_usage_rollout WHERE thread_id=?").run(file.threadId);
          this.store.raw.prepare(`INSERT INTO codex_usage_rollout VALUES (@threadId,@sourceHash,@sourceCategory,@encoding,@fileSize,@mtimeMs,@byteOffset,@nextOrdinal,@sessionStartedAt,@lastEventAt,@projectKey,@projectLabel,@latestModel,@previousInputTokens,@previousCachedInputTokens,@previousOutputTokens,@previousReasoningOutputTokens,@warningCount,@lastScannedAt)
            ON CONFLICT(thread_id) DO UPDATE SET source_hash=excluded.source_hash,source_category=excluded.source_category,encoding=excluded.encoding,file_size=excluded.file_size,mtime_ms=excluded.mtime_ms,byte_offset=excluded.byte_offset,next_ordinal=excluded.next_ordinal,session_started_at=excluded.session_started_at,last_event_at=excluded.last_event_at,project_key=excluded.project_key,project_label=excluded.project_label,latest_model=excluded.latest_model,previous_input_tokens=excluded.previous_input_tokens,previous_cached_input_tokens=excluded.previous_cached_input_tokens,previous_output_tokens=excluded.previous_output_tokens,previous_reasoning_output_tokens=excluded.previous_reasoning_output_tokens,warning_count=excluded.warning_count,last_scanned_at=excluded.last_scanned_at`).run(state);
          const insert = this.store.raw.prepare("INSERT OR REPLACE INTO codex_usage_event VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
          for (const event of events) insert.run(file.threadId, event.ordinal, event.occurredAt, event.kind, event.model, event.projectKey, event.projectLabel, event.inputTokens, event.cachedInputTokens, event.outputTokens, event.reasoningOutputTokens, event.totalTokens);
          this.store.raw.prepare("DELETE FROM codex_usage_missing_candidate WHERE source_hash=? AND thread_id=?").run(sourceHash, file.threadId);
          if (retainedMissing.has(file.threadId)) {
            const restoredAt = Date.now();
            if (this.store.raw.prepare("UPDATE codex_usage_retained_rollout SET restored_at=? WHERE source_hash=? AND thread_id=? AND restored_at IS NULL").run(restoredAt, sourceHash, file.threadId).changes) {
              this.store.recordAudit("source_restored", { sessionHash: file.threadId, sourceCategory: file.sourceCategory, scanBatch });
            }
          }
        });
        warnings += state.warningCount; changed = true;
      }

      if (discovery.complete) {
        const now = Date.now(); const confirmed: RolloutState[] = [];
        this.store.transaction(() => {
          for (const threadId of seen) this.store.raw.prepare("DELETE FROM codex_usage_missing_candidate WHERE source_hash=? AND thread_id=?").run(sourceHash, threadId);
          for (const [threadId, state] of existing) {
            if (seen.has(threadId)) continue;
            const candidate = this.store.raw.prepare("SELECT first_missing_at AS firstMissingAt,confirmations FROM codex_usage_missing_candidate WHERE source_hash=? AND thread_id=?").get(sourceHash, threadId) as { firstMissingAt: number; confirmations: number } | undefined;
            if (candidate && candidate.confirmations >= 1 && now - candidate.firstMissingAt >= this.minimumMissingAgeMs) confirmed.push(state);
            else this.store.raw.prepare(`INSERT INTO codex_usage_missing_candidate VALUES (?,?,?,?,?,?)
              ON CONFLICT(source_hash,thread_id) DO UPDATE SET last_missing_at=excluded.last_missing_at`).run(sourceHash, threadId, candidate?.firstMissingAt ?? now, now, candidate?.confirmations ?? 1, generation);
          }
          if (confirmed.length) this.retainRolloutsInTransaction(confirmed, "source_missing", scanBatch);
          this.store.raw.prepare("UPDATE codex_usage_source SET last_successful_scan_at=?,scan_generation=?,discovered_rollouts=? WHERE source_hash=?").run(now, generation, discovery.files.length, sourceHash);
        });
        if (confirmed.length) { retentionChanged = true; changed = true; }
      }

      this.status = warnings > 0 || !discovery.complete ? "partial" : "ready";
      await this.store.flushAudit();
      const backup = this.store.status().backup;
      const today = new Date().toISOString().slice(0, 10);
      if (!backup.lastSuccessfulAt || new Date(backup.lastSuccessfulAt).toISOString().slice(0, 10) !== today) this.scheduleBackup("daily");
      if (retentionChanged) this.scheduleBackup("retention");
      if (sourceChanged) this.scheduleBackup("source_changed");
    } catch (error) {
      this.status = "partial";
      this.log.warn({ error: error instanceof Error ? error.name : "unknown" }, "Codex usage scan failed");
    } finally {
      if (scanBatch !== null) this.store.raw.prepare("UPDATE codex_usage_scan_batch SET completed_at=?,status=? WHERE id=?").run(Date.now(), this.status, scanBatch);
      this.scanning = false;
      if (changed || previousStatus !== this.status) this.onChange();
    }
  }

  getDashboard(filters: CodexUsageFilters): Record<string, unknown> {
    const sourceHash = this.currentSourceHash ?? this.store.currentSource() ?? this.store.sourceKey(codexHomeDir());
    const events = this.store.raw.prepare(`SELECT e.thread_id AS threadId, e.occurred_at AS occurredAt, e.kind, e.model, e.project_key AS projectKey,
      e.project_label AS projectLabel, e.input_tokens AS inputTokens, e.cached_input_tokens AS cachedInputTokens,
      e.output_tokens AS outputTokens, e.reasoning_output_tokens AS reasoningOutputTokens, e.total_tokens AS totalTokens
      FROM codex_usage_event e JOIN codex_usage_rollout r ON r.thread_id=e.thread_id WHERE r.source_hash=?
      UNION ALL
      SELECT e.thread_id AS threadId, e.occurred_at AS occurredAt, e.kind, e.model, e.project_key AS projectKey,
      e.project_label AS projectLabel, e.input_tokens AS inputTokens, e.cached_input_tokens AS cachedInputTokens,
      e.output_tokens AS outputTokens, e.reasoning_output_tokens AS reasoningOutputTokens, e.total_tokens AS totalTokens
      FROM codex_usage_retained_event e WHERE e.source_hash=? AND NOT EXISTS
        (SELECT 1 FROM codex_usage_event active_event JOIN codex_usage_rollout r ON r.thread_id=active_event.thread_id
          WHERE r.source_hash=? AND active_event.thread_id=e.thread_id AND active_event.ordinal=e.ordinal)
      ORDER BY occurredAt`).all(sourceHash, sourceHash, sourceHash) as Array<CodexUsageEvent & { threadId: string }>;
    const activeCoverage = this.store.raw.prepare(`SELECT COUNT(*) AS count, MIN(session_started_at) AS firstAt, MAX(last_event_at) AS lastAt,
      MAX(last_scanned_at) AS scannedAt, SUM(warning_count) AS warnings FROM codex_usage_rollout WHERE source_hash=?`).get(sourceHash) as { count: number; firstAt: number | null; lastAt: number | null; scannedAt: number | null; warnings: number | null };
    const retainedCoverage = this.store.raw.prepare(`SELECT COUNT(*) AS count, MIN(session_started_at) AS firstAt, MAX(last_event_at) AS lastAt,
      MAX(last_scanned_at) AS scannedAt, SUM(warning_count) AS warnings, MAX(missing_at) AS retainedAt
      FROM codex_usage_retained_rollout rr WHERE source_hash=? AND restored_at IS NULL AND NOT EXISTS
        (SELECT 1 FROM codex_usage_rollout r WHERE r.source_hash=rr.source_hash AND r.thread_id=rr.thread_id)`).get(sourceHash) as { count: number; firstAt: number | null; lastAt: number | null; scannedAt: number | null; warnings: number | null; retainedAt: number | null };
    const sourceCoverage = this.store.raw.prepare("SELECT last_successful_scan_at AS lastSuccessfulAt,discovered_rollouts AS discoveredRollouts FROM codex_usage_source WHERE source_hash=?").get(sourceHash) as { lastSuccessfulAt: number | null; discoveredRollouts: number } | undefined;
    const pendingMissingRollouts = (this.store.raw.prepare("SELECT COUNT(*) AS count FROM codex_usage_missing_candidate WHERE source_hash=?").get(sourceHash) as { count: number }).count;
    const storeStatus = this.store.status();
    const presentTimes = (values: Array<number | null>) => values.filter((value): value is number => value !== null);
    const firstTimes = presentTimes([activeCoverage.firstAt, retainedCoverage.firstAt, events[0]?.occurredAt ?? null]);
    const lastTimes = presentTimes([activeCoverage.lastAt, retainedCoverage.lastAt, events.at(-1)?.occurredAt ?? null]);
    const scannedTimes = presentTimes([activeCoverage.scannedAt, retainedCoverage.scannedAt]);
    const coverageFirstAt = firstTimes.length ? Math.min(...firstTimes) : null;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    const day = (time: number) => dayFormatter.format(new Date(time));
    const datedEvents = events.map((event) => ({ ...event, localDay: day(event.occurredAt) }));
    const today = day(Date.now());
    const count = filters.range === "all" ? null : Number.parseInt(filters.range, 10);
    let days: string[] = [];
    if (count) for (let i = count - 1; i >= 0; i--) days.push(day(Date.now() - i * 86_400_000));
    else if (datedEvents.length) for (let cursor = datedEvents[0].occurredAt; day(cursor) <= today; cursor += 86_400_000) { const value = day(cursor); if (!days.includes(value)) days.push(value); }
    const coverageStart = coverageFirstAt === null ? null : day(coverageFirstAt);
    if (coverageStart) days = days.filter((value) => value >= coverageStart);
    const start = days[0] ?? today;
    const inRange = datedEvents.filter((event) => event.localDay >= start && event.localDay <= today);
    const matchesModel = (event: { model: string | null }) => !filters.model || event.model === filters.model;
    const matchesProject = (event: { projectKey: string | null }) => !filters.project || event.projectKey === filters.project;
    const selected = inRange.filter((event) => matchesModel(event) && matchesProject(event));
    const sum = (items: typeof selected, key: keyof CodexUsageEvent) => items.reduce((total, event) => total + Number(event[key] ?? 0), 0);
    const daily = days.map((date) => {
      const items = selected.filter((event) => event.localDay === date);
      const inputTokens = sum(items, "inputTokens"), cachedInputTokens = sum(items, "cachedInputTokens"), outputTokens = sum(items, "outputTokens");
      return { date, inputTokens, cachedInputTokens, uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens), outputTokens,
        reasoningOutputTokens: sum(items, "reasoningOutputTokens"), totalTokens: inputTokens + outputTokens,
        sessions: new Set(items.map((item) => item.threadId)).size, tasks: items.filter((item) => item.kind === "task_started").length,
        rollingAverage7d: 0, isPartial: date === today };
    });
    daily.forEach((entry, index) => { const window = daily.slice(Math.max(0, index - 6), index + 1); entry.rollingAverage7d = Math.round(window.reduce((n, item) => n + item.totalTokens, 0) / window.length); });
    const rank = (items: Array<CodexUsageEvent & { threadId: string }>, dimension: "model" | "project") => {
      const map = new Map<string, { key: string; label: string; totalTokens: number; tasks: number }>();
      for (const event of items) { const key = dimension === "model" ? event.model : event.projectKey; if (!key) continue;
        const label = dimension === "model" ? event.model! : event.projectLabel ?? "未知项目"; const row = map.get(key) ?? { key, label, totalTokens: 0, tasks: 0 };
        row.totalTokens += event.totalTokens; if (event.kind === "task_started") row.tasks += 1; map.set(key, row); }
      const rows = [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens); const total = rows.reduce((n, row) => n + row.totalTokens, 0);
      return rows.map((row) => ({ ...row, share: total ? row.totalTokens / total : 0 }));
    };
    const modelRows = rank(inRange.filter(matchesProject), "model");
    const modelTrendEvents = inRange.filter(matchesProject);
    const dailyModels = days.map((date) => {
      const items = modelTrendEvents.filter((event) => event.localDay === date && event.model && event.totalTokens > 0);
      const totals = new Map<string, number>();
      for (const event of items) totals.set(event.model!, (totals.get(event.model!) ?? 0) + event.totalTokens);
      const models = modelRows.map((model) => ({ key: model.key, label: model.label, totalTokens: totals.get(model.key) ?? 0 })).filter((model) => model.totalTokens > 0);
      return { date, totalTokens: models.reduce((total, model) => total + model.totalTokens, 0), isPartial: date === today, models };
    });
    const allProjects = rank(inRange.filter(matchesModel), "project");
    const projects = limitProjectRows(allProjects);
    const inputTokens = sum(selected, "inputTokens"), cachedInputTokens = sum(selected, "cachedInputTokens"), outputTokens = sum(selected, "outputTokens");
    const tasksStarted = selected.filter((event) => event.kind === "task_started").length, tasksCompleted = selected.filter((event) => event.kind === "task_completed").length;
    // The heatmap covers the whole retained history rather than the selected
    // slice. Populate every calendar day so a quiet day remains visible.
    const hourFormatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" });
    const heat = new Map<string, number>(); for (const event of datedEvents.filter((item) => item.kind === "token_usage")) { const hour = Number(hourFormatter.format(new Date(event.occurredAt))); const key = `${event.localDay}|${hour}`; heat.set(key, (heat.get(key) ?? 0) + event.totalTokens); }
    const heatDays: string[] = [];
    if (coverageFirstAt !== null) for (let cursor = coverageFirstAt; day(cursor) <= today; cursor += 86_400_000) { const value = day(cursor); if (!heatDays.includes(value)) heatDays.push(value); }
    return { status: this.scanning ? "scanning" : (storeStatus.pendingAuditEvents > 0 ? "partial" : this.status), scope: "local_codex_home", generatedAt: Date.now(), timezone,
      coverage: { firstEventAt: coverageFirstAt, lastEventAt: lastTimes.length ? Math.max(...lastTimes) : null,
        rollouts: activeCoverage.count + retainedCoverage.count, sourceRollouts: sourceCoverage?.discoveredRollouts ?? 0, retainedRollouts: retainedCoverage.count,
        lastScannedAt: scannedTimes.length ? Math.max(...scannedTimes) : null, lastRetentionAt: retainedCoverage.retainedAt,
        parseWarnings: (activeCoverage.warnings ?? 0) + (retainedCoverage.warnings ?? 0),
        scan: { complete: this.scanComplete, lastSuccessfulAt: sourceCoverage?.lastSuccessfulAt ?? null, pendingMissingRollouts },
        retention: { pendingAuditEvents: storeStatus.pendingAuditEvents, lastVerifiedAt: storeStatus.lastVerifiedAt },
        backup: storeStatus.backup },
      summary: { totalTokens: inputTokens + outputTokens, todayTokens: daily.at(-1)?.totalTokens ?? 0, dailyAverage: daily.length ? Math.round((inputTokens + outputTokens) / daily.length) : 0,
        inputTokens, cachedInputTokens, uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens), outputTokens, reasoningOutputTokens: sum(selected, "reasoningOutputTokens"),
        cacheHitPercent: inputTokens ? cachedInputTokens / inputTokens * 100 : 0, sessions: new Set(selected.map((item) => item.threadId)).size,
        tasksStarted, tasksCompleted, abortedTurns: selected.filter((event) => event.kind === "turn_aborted").length,
        compactions: selected.filter((event) => event.kind === "context_compacted").length, completionPercent: tasksStarted ? tasksCompleted / tasksStarted * 100 : 0,
        tokensPerCompletedTask: tasksCompleted ? Math.round((inputTokens + outputTokens) / tasksCompleted) : 0 },
      daily, dailyModels, models: modelRows, projects,
      heatmap: heatDays.flatMap((date) => Array.from({ length: 24 }, (_, hour) => ({ date, hour, totalTokens: heat.get(`${date}|${hour}`) ?? 0 }))),
      filters: { models: [...new Set(events.map((event) => event.model).filter(Boolean))], projects: rank(events, "project").map(({ key, label }) => ({ key, label })) } };
  }
}

export const codexUsageInternals = { parseAllowedLine, projectIdentity, limitProjectRows };
