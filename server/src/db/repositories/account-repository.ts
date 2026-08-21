import type Database from "better-sqlite3";
import type { AccountRecord, AuthStatus, RateLimitSnapshot } from "../../types.js";

type SqliteDatabase = Database.Database;

export interface NewAccount {
  id: string;
  codexHome: string;
}

export type AccountPatch = Partial<Pick<AccountRecord, "chatgptAccountId" | "email" | "planType" | "subscriptionStartedAt" | "subscriptionExpiresAt" | "subscriptionExpirySource" | "enabled" | "authStatus" | "fedRamp" | "authMode" | "authCheckedAt" | "authLastSuccessfulAt" | "authErrorCode">>;

function asAccount(row: Record<string, unknown>): AccountRecord {
  return {
    id: String(row.id),
    chatgptAccountId: row.chatgpt_account_id == null ? null : String(row.chatgpt_account_id),
    email: row.email == null ? null : String(row.email),
    planType: row.plan_type == null ? null : String(row.plan_type),
    subscriptionStartedAt: row.subscription_started_at == null ? null : Number(row.subscription_started_at),
    subscriptionExpiresAt: row.subscription_expires_at == null ? null : Number(row.subscription_expires_at),
    subscriptionExpirySource: row.subscription_expiry_source == null ? null : String(row.subscription_expiry_source) as AccountRecord["subscriptionExpirySource"],
    codexHome: String(row.codex_home),
    enabled: Boolean(row.enabled),
    authStatus: String(row.auth_status) as AuthStatus,
    fedRamp: Boolean(row.fedramp),
    primaryUsedPercent: row.primary_used_percent == null ? null : Number(row.primary_used_percent),
    primaryResetsAt: row.primary_resets_at == null ? null : Number(row.primary_resets_at),
    primaryWindowMinutes: row.primary_window_minutes == null ? null : Number(row.primary_window_minutes),
    secondaryUsedPercent: row.secondary_used_percent == null ? null : Number(row.secondary_used_percent),
    secondaryResetsAt: row.secondary_resets_at == null ? null : Number(row.secondary_resets_at),
    secondaryWindowMinutes: row.secondary_window_minutes == null ? null : Number(row.secondary_window_minutes),
    rateLimitReachedType: row.rate_limit_reached_type == null ? null : String(row.rate_limit_reached_type),
    authMode: row.auth_mode == null ? null : String(row.auth_mode),
    authCheckedAt: row.auth_checked_at == null ? null : Number(row.auth_checked_at),
    authLastSuccessfulAt: row.auth_last_successful_at == null ? null : Number(row.auth_last_successful_at),
    authErrorCode: row.auth_error_code == null ? null : String(row.auth_error_code),
    limitsSnapshotJson: row.limits_snapshot_json == null ? null : String(row.limits_snapshot_json),
    lastAuthRefreshAt: row.last_auth_refresh_at == null ? null : Number(row.last_auth_refresh_at),
    lastLimitsRefreshAt: row.last_limits_refresh_at == null ? null : Number(row.last_limits_refresh_at),
    lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export class AccountRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(): AccountRecord[] {
    return (this.db.prepare("SELECT * FROM accounts ORDER BY created_at ASC").all() as Record<string, unknown>[]).map(asAccount);
  }

  get(id: string): AccountRecord | null {
    const row = this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? asAccount(row) : null;
  }

  findByChatgptAccountId(chatgptAccountId: string): AccountRecord | null {
    const row = this.db.prepare("SELECT * FROM accounts WHERE chatgpt_account_id = ?").get(chatgptAccountId) as Record<string, unknown> | undefined;
    return row ? asAccount(row) : null;
  }

  insert(input: NewAccount): AccountRecord {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO accounts(id, label, codex_home, enabled, is_default, auth_status, created_at, updated_at)
      VALUES (?, '', ?, 1, 0, 'login_pending', ?, ?)
    `).run(input.id, input.codexHome, now, now);
    return this.get(input.id)!;
  }

  update(id: string, patch: AccountPatch): AccountRecord {
    const current = this.get(id);
    if (!current) throw new Error("account_not_found");
    const next = { ...current, ...patch };
    this.db.prepare(`
      UPDATE accounts SET
        chatgpt_account_id=?, email=?, plan_type=?, subscription_started_at=?, subscription_expires_at=?, subscription_expiry_source=?,
        enabled=?, auth_status=?, fedramp=?, auth_mode=?, auth_checked_at=?, auth_last_successful_at=?, auth_error_code=?, updated_at=?
      WHERE id=?
    `).run(next.chatgptAccountId, next.email, next.planType, next.subscriptionStartedAt, next.subscriptionExpiresAt, next.subscriptionExpirySource, next.enabled ? 1 : 0, next.authStatus, next.fedRamp ? 1 : 0, next.authMode, next.authCheckedAt, next.authLastSuccessfulAt, next.authErrorCode, Date.now(), id);
    return this.get(id)!;
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM accounts WHERE id=?").run(id);
  }

  updateRateLimits(id: string, limits: RateLimitSnapshot): void {
    this.db.prepare(`
      UPDATE accounts SET
        primary_used_percent=?, primary_resets_at=?, primary_window_minutes=?,
        secondary_used_percent=?, secondary_resets_at=?, secondary_window_minutes=?,
        rate_limit_reached_type=?, limits_snapshot_json=?,
        plan_type=COALESCE(?, plan_type),
        auth_status=CASE WHEN auth_status='rate_limited' AND ? IS NULL THEN 'ready' ELSE auth_status END,
        last_limits_refresh_at=?, updated_at=?
      WHERE id=?
    `).run(
      limits.primary?.usedPercent ?? null,
      limits.primary?.resetsAt ?? null,
      limits.primary?.windowDurationMins ?? null,
      limits.secondary?.usedPercent ?? null,
      limits.secondary?.resetsAt ?? null,
      limits.secondary?.windowDurationMins ?? null,
      limits.rateLimitReachedType ?? null,
      JSON.stringify(limits),
      limits.planType,
      limits.rateLimitReachedType ?? null,
      limits.loadedAt,
      Date.now(),
      id,
    );
  }

  markAuthRefreshed(id: string): void {
    const now = Date.now();
    this.db.prepare("UPDATE accounts SET auth_status='ready', last_auth_refresh_at=?, auth_checked_at=?, auth_last_successful_at=?, auth_error_code=NULL, updated_at=? WHERE id=?").run(now, now, now, now, id);
  }
}
