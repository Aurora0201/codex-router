import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

type SqliteDatabase = Database.Database;

/** Who asked for it. The automatic one is the gateway spending on its own. */
export const WARMUP_TRIGGERS = ["manual", "auto"] as const;
export type WarmupTrigger = (typeof WARMUP_TRIGGERS)[number];

export const WARMUP_OUTCOMES = ["running", "pending", "warmed", "skipped", "failed"] as const;
export type WarmupOutcome = (typeof WARMUP_OUTCOMES)[number];

export interface WarmupLogEntry {
  id: string;
  startedAt: number;
  accountId: string;
  trigger: WarmupTrigger;
  outcome: WarmupOutcome;
  /** The model the turn actually ran on, which is not always the one asked for. */
  model: string | null;
  durationMs: number | null;
  /**
   * A classified code, never an upstream message: those can carry prompt or
   * response text, which never reaches the database.
   */
  errorCode: string | null;
  /** The short window as it stood before and after, in reset timestamps. */
  windowBeforeResetsAt: number | null;
  windowAfterResetsAt: number | null;
}

/**
 * Warm-up spends quota, and the automatic mode spends it without asking each
 * time; the trace is the compensation for that, the same way the switch log is
 * the compensation for losing attribution. It records the window on both sides
 * because "the turn succeeded" is not the question anyone has — "did the
 * five-hour window actually start" is.
 */
export class WarmupLogRepository {
  /** Display cap only. Safety counters must never be pruned by a UI limit. */
  private static readonly KEEP = 200;

  constructor(private readonly db: SqliteDatabase) {}

  record(entry: Omit<WarmupLogEntry, "id">): WarmupLogEntry {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO account_warmup_log(
           id, started_at, account_id, trigger, outcome, model, duration_ms, error_code,
           window_before_resets_at, window_after_resets_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entry.startedAt,
        entry.accountId,
        entry.trigger,
        entry.outcome,
        entry.model,
        entry.durationMs,
        entry.errorCode,
        entry.windowBeforeResetsAt,
        entry.windowAfterResetsAt,
      );
    return { id, ...entry };
  }

  finish(id: string, entry: Pick<WarmupLogEntry, "outcome" | "model" | "durationMs" | "errorCode" | "windowAfterResetsAt">): void {
    this.db.prepare(`UPDATE account_warmup_log SET outcome=?, model=?, duration_ms=?, error_code=?,
      window_after_resets_at=? WHERE id=? AND outcome='running'`)
      .run(entry.outcome, entry.model, entry.durationMs, entry.errorCode, entry.windowAfterResetsAt, id);
  }

  interruptRunning(): void {
    this.db.prepare(`UPDATE account_warmup_log SET outcome='failed', error_code='gateway_process_interrupted'
      WHERE outcome='running'`).run();
  }

  confirmPending(accountId: string, endsAt: number): void {
    this.db.prepare(`UPDATE account_warmup_log SET outcome='warmed', error_code=NULL, window_after_resets_at=?
      WHERE account_id=? AND outcome='pending' AND started_at >= ?`)
      .run(endsAt, accountId, this.resetAt(accountId) ?? 0);
  }

  noteReset(accountId: string): void {
    this.db.prepare(`INSERT INTO account_warmup_state(account_id, reset_at) VALUES (?, ?)
      ON CONFLICT(account_id) DO UPDATE SET reset_at=excluded.reset_at`).run(accountId, Date.now());
    this.db.prepare(`UPDATE account_warmup_log SET outcome='failed', error_code='window_reset_before_confirmation'
      WHERE account_id=? AND outcome='pending'`).run(accountId);
  }

  resetAt(accountId: string): number | null {
    const row = this.db.prepare("SELECT reset_at FROM account_warmup_state WHERE account_id=?").get(accountId) as { reset_at: number } | undefined;
    return row?.reset_at ?? null;
  }

  hasPending(accountId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM account_warmup_log WHERE account_id=? AND outcome='pending' LIMIT 1").get(accountId);
  }

  recent(limit = 20): WarmupLogEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM account_warmup_log ORDER BY started_at DESC, id DESC LIMIT ?")
      .all(Math.min(Math.max(1, limit), WarmupLogRepository.KEEP)) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      startedAt: Number(row.started_at),
      accountId: String(row.account_id),
      trigger: String(row.trigger) as WarmupTrigger,
      outcome: String(row.outcome) as WarmupOutcome,
      model: row.model == null ? null : String(row.model),
      durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
      errorCode: row.error_code == null ? null : String(row.error_code),
      windowBeforeResetsAt: row.window_before_resets_at == null ? null : Number(row.window_before_resets_at),
      windowAfterResetsAt: row.window_after_resets_at == null ? null : Number(row.window_after_resets_at),
    }));
  }

  /**
   * Attempts on one account since a moment, optionally only the ones with a
   * given trigger. The daily cap reads this, so a bug that keeps deciding an
   * account needs warming cannot drain it: the ceiling survives a restart
   * because it is counted from the log rather than held in memory.
   *
   * The cap counts automatic attempts only. It exists to bound what the gateway
   * spends on its own; a person warming an account by hand is not the gateway
   * deciding anything, and should not use up its allowance.
   */
  countSince(accountId: string, since: number, trigger?: WarmupTrigger): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM account_warmup_log
         WHERE account_id = ? AND started_at >= ? AND outcome != 'skipped'
           AND (? IS NULL OR trigger = ?)`,
      )
      .get(accountId, since, trigger ?? null, trigger ?? null) as { n: number };
    return Number(row.n);
  }

  /** When this account was last attempted, which is what the cooldown reads. */
  lastAttemptAt(accountId: string): number | null {
    const row = this.db
      .prepare("SELECT started_at FROM account_warmup_log WHERE account_id = ? AND outcome != 'skipped' ORDER BY started_at DESC LIMIT 1")
      .get(accountId) as { started_at: number } | undefined;
    return row === undefined ? null : Number(row.started_at);
  }
}
