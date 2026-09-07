import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

type SqliteDatabase = Database.Database;

export const SWITCH_REASONS = [
  "quota_below_threshold",
  "upstream_rate_limited",
  "account_unavailable",
  "higher_priority_recovered",
] as const;
export type SwitchReason = (typeof SWITCH_REASONS)[number];

export interface SwitchLogEntry {
  id: string;
  switchedAt: number;
  fromAccountId: string | null;
  toAccountId: string | null;
  reason: SwitchReason;
  /** True when the switch was only recorded, not performed. */
  dryRun: boolean;
  /** The judgement at the moment, so a past decision can be re-read. */
  evidence: Record<string, unknown> | null;
}

/**
 * The ADR treats this as part of the auto-switch feature rather than as a log:
 * automatic switching costs the user the ability to say which account served a
 * request, and this is what gives that back.
 */
export class AccountSwitchLogRepository {
  constructor(private readonly db: SqliteDatabase) {}

  record(entry: Omit<SwitchLogEntry, "id">): SwitchLogEntry {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO account_switch_log(id, switched_at, from_account_id, to_account_id, reason, dry_run, evidence_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entry.switchedAt,
        entry.fromAccountId,
        entry.toAccountId,
        entry.reason,
        entry.dryRun ? 1 : 0,
        entry.evidence === null ? null : JSON.stringify(entry.evidence),
      );
    return { id, ...entry };
  }

  recent(limit = 20): SwitchLogEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM account_switch_log ORDER BY switched_at DESC LIMIT ?")
      .all(Math.min(Math.max(1, limit), 100)) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      switchedAt: Number(row.switched_at),
      fromAccountId: row.from_account_id == null ? null : String(row.from_account_id),
      toAccountId: row.to_account_id == null ? null : String(row.to_account_id),
      reason: String(row.reason) as SwitchReason,
      dryRun: Number(row.dry_run) === 1,
      evidence: row.evidence_json == null ? null : (JSON.parse(String(row.evidence_json)) as Record<string, unknown>),
    }));
  }

  /** When the routed account last changed, which is what min-dwell measures from. */
  lastSwitchAt(): number | null {
    const row = this.db
      .prepare("SELECT switched_at FROM account_switch_log WHERE dry_run=0 ORDER BY switched_at DESC LIMIT 1")
      .get() as { switched_at?: number } | undefined;
    return row?.switched_at == null ? null : Number(row.switched_at);
  }
}
