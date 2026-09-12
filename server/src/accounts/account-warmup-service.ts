import { listWarmupModels, safeWarmupError, sendWarmupTurn, type WarmupModel } from "./warmup-rpc.js";
export type { WarmupModel } from "./warmup-rpc.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AccountRecord, GatewayConfig } from "../types.js";
import type { GatewayDatabase } from "../db/database.js";
import type { WarmupTrigger } from "../db/repositories/warmup-log-repository.js";
import { AccountOperationLock } from "./account-lock.js";
import { withAppServerClient } from "./app-server-client.js";
import type { AccountStatusService } from "./account-status-service.js";
import {
  longWindowExhausted,
  shortWindowEndsAt,
  shortWindowResetsAt,
  shortWindowRunning,
  shortWindowState,
} from "./quota-windows.js";
export * from "./quota-windows.js";

export type WarmupSkipReason =
  | "window_running"
  | "cooldown"
  | "daily_limit"
  | "not_enrolled"
  | "not_ready"
  | "window_unknown"
  | "no_short_window"
  | "weekly_exhausted"
  | "auto_disabled"
  | "pending_confirmation";

export interface WarmupAccountResult {
  accountId: string;
  outcome: "warmed" | "pending" | "skipped" | "failed";
  /** Why it was passed over, when it was. */
  skipped: WarmupSkipReason | null;
  errorCode: string | null;
  model: string | null;
  durationMs: number | null;
  windowBeforeResetsAt: number | null;
  windowAfterResetsAt: number | null;
}

export interface WarmupRunResult {
  trigger: WarmupTrigger;
  startedAt: number;
  results: WarmupAccountResult[];
}

export interface WarmupProgress {
  running: boolean;
  /** How many accounts this run will attempt, and how many are done. */
  total: number;
  done: number;
  accountId: string | null;
}

const DAY_MS = 24 * 3_600_000;

/**
 * Sends one small turn on an account so its five-hour window starts counting.
 *
 * The turn runs on the account's own `CODEX_HOME`, which means it goes straight
 * upstream on that account's credentials rather than through the proxy. Nothing
 * about the routed account changes, and there is no window where the wrong
 * account could be charged — the identity is the directory, decided before the
 * process starts, not a header decided per request.
 */
export class AccountWarmupService {
  private active: Promise<WarmupRunResult> | null = null;
  private progress: WarmupProgress = { running: false, total: 0, done: 0, accountId: null };
  private closed = false;

  constructor(
    private readonly config: GatewayConfig,
    private readonly database: GatewayDatabase,
    private readonly status: AccountStatusService,
    private readonly onProgress: (progress: WarmupProgress) => void = () => undefined,
    /**
     * Shared with the status service on purpose. Two `codex app-server`
     * processes on one CODEX_HOME contend for the same SQLite files, and a
     * warm-up turn is long enough for the five-minute status sweep to land on
     * top of it.
     */
    private readonly lock = new AccountOperationLock(),
  ) {}

  async close(): Promise<void> {
    this.closed = true;
    await this.active?.catch(() => undefined);
    await this.lock.drain();
  }

  currentProgress(): WarmupProgress {
    return { ...this.progress };
  }

  /**
   * Enrolled, enabled, authenticated, and with a week left to spend: the
   * accounts warm-up may touch at all. Not even a forced run sends to an
   * account whose week is gone — forcing means "spend even if the window may
   * already be counting", not "send what the account is certain to refuse".
   */
  candidates(now = Date.now()): AccountRecord[] {
    return this.database.accounts
      .list()
      .filter(
        (account) =>
          account.warmupEnrolled &&
          account.enabled &&
          account.authStatus === "ready" &&
          !longWindowExhausted(account, now),
      );
  }

  /** Of those, the ones whose short window is not already counting. */
  pending(now = Date.now()): AccountRecord[] {
    return this.candidates(now).filter((account) => shortWindowState(account, now) === "ready");
  }

  /**
   * What an automatic pass would actually warm right now — the same question
   * the run asks, asked before starting one. Without it every status refresh
   * during a cooldown would start a run that skips everything and still tells
   * the console and the router to look again.
   */
  autoTargets(): AccountRecord[] {
    const settings = this.database.settings.warmup();
    return this.candidates().filter((account) => this.skipReason(account, settings, { trigger: "auto" }) === null);
  }

  /**
   * The catalog, read from any ready account. Models are a property of the
   * subscription rather than of the router, so one account's list is the best
   * available answer for a picker that applies to all of them; a model an
   * account cannot use falls back to that account's default at turn time.
   */
  async models(): Promise<WarmupModel[]> {
    if (this.closed) throw new Error("warmup_service_closed");
    const account =
      this.candidates()[0] ?? this.database.accounts.list().find((a) => a.enabled && a.authStatus === "ready");
    if (!account) return [];
    return this.lock.run(account.id, async () => {
      const latest = this.database.accounts.get(account.id);
      if (this.closed) throw new Error("warmup_service_closed");
      if (!latest || !latest.enabled || latest.authStatus !== "ready") throw new Error("account_not_ready");
      return withAppServerClient(this.config, latest.codexHome, listWarmupModels);
    });
  }

  /**
   * One run over the chosen accounts, serially. Serial because three
   * app-servers at once is three copies of Codex resident for no gain, and
   * because a failure part-way through should leave a legible half-done run
   * rather than an interleaved one.
   */
  run(options: { trigger: WarmupTrigger; force?: boolean; accountIds?: string[] }): Promise<WarmupRunResult> {
    if (this.closed) return Promise.reject(new Error("warmup_service_closed"));
    // One at a time, whoever asked. A second click, a second tab and the
    // automatic pass all meet here.
    if (this.active) return Promise.reject(new Error("warmup_already_running"));
    const run = this.runInner(options).finally(() => {
      this.active = null;
      this.publish({ running: false, total: 0, done: 0, accountId: null });
    });
    this.active = run;
    return run;
  }

  isRunning(): boolean {
    return this.active !== null;
  }

  private publish(progress: WarmupProgress): void {
    this.progress = progress;
    this.onProgress({ ...progress });
  }

  private async runInner(options: {
    trigger: WarmupTrigger;
    force?: boolean;
    accountIds?: string[];
  }): Promise<WarmupRunResult> {
    const startedAt = Date.now();
    const wanted = new Set(options.accountIds ?? []);
    const targets = this.candidates().filter((account) => options.accountIds === undefined || wanted.has(account.id));
    const results: WarmupAccountResult[] = [];

    this.publish({ running: true, total: targets.length, done: 0, accountId: null });
    const work = await mkdtemp(path.join(os.tmpdir(), "codex-router-warmup-"));
    try {
      for (const account of targets) {
        if (this.closed) break;
        this.publish({ running: true, total: targets.length, done: results.length, accountId: account.id });
        if (
          options.trigger === "auto" &&
          (Date.now() - (account.lastLimitsRefreshAt ?? 0) > 30_000 || shortWindowState(account) === "expired")
        ) {
          try {
            await this.status.refresh(account.id);
          } catch {
            results.push(this.skipped(account.id, "window_unknown"));
            continue;
          }
        }
        if (this.closed) break;
        results.push(await this.warmOne(account.id, options, work));
      }
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
    return { trigger: options.trigger, startedAt, results };
  }

  private skipReason(
    account: AccountRecord,
    settings: ReturnType<GatewayDatabase["settings"]["warmup"]>,
    options: { trigger: WarmupTrigger; force?: boolean },
  ): WarmupSkipReason | null {
    if (!account.enabled || account.authStatus !== "ready") return "not_ready";
    if (!account.warmupEnrolled) return "not_enrolled";
    if (longWindowExhausted(account)) return "weekly_exhausted";
    if (options.trigger === "auto" && !settings.auto) return "auto_disabled";
    // Forcing is a person deciding to spend anyway; the guards that exist to
    // stop the gateway spending on its own still apply to the automatic pass.
    if (!options.force && shortWindowRunning(account)) return "window_running";
    if (options.trigger === "manual" && options.force) return null;
    const state = shortWindowState(account);
    if (state === "unavailable") return "no_short_window";
    if (state !== "ready") return "window_unknown";
    if (options.trigger === "auto" && Date.now() - (account.lastLimitsRefreshAt ?? 0) > 30_000) return "window_unknown";
    if (this.database.warmupLog.hasPending(account.id)) return "pending_confirmation";
    const last = this.database.warmupLog.lastAttemptAt(account.id);
    const reset = this.database.warmupLog.resetAt(account.id);
    if (last !== null && (reset === null || reset <= last) && Date.now() - last < settings.cooldownMs)
      return "cooldown";
    if (this.database.warmupLog.countSince(account.id, Date.now() - DAY_MS, "auto") >= settings.dailyLimit)
      return "daily_limit";
    return null;
  }

  private async warmOne(
    accountId: string,
    options: { trigger: WarmupTrigger; force?: boolean },
    work: string,
  ): Promise<WarmupAccountResult> {
    // Validate again AFTER acquiring the lock; queued work may outlive an
    // account's enrollment, credentials, directory or the auto setting.
    const attempt = await this.lock.run(accountId, async () => {
      const account = this.database.accounts.get(accountId);
      if (this.closed || !account) return this.skipped(accountId, "not_ready");
      const settings = this.database.settings.warmup();
      const skip = this.skipReason(account, settings, options);
      if (skip) return this.skipped(accountId, skip);
      const entry = this.database.warmupLog.record({
        accountId,
        trigger: options.trigger,
        startedAt: Date.now(),
        outcome: "running",
        model: settings.model,
        errorCode: null,
        durationMs: null,
        windowBeforeResetsAt: shortWindowEndsAt(account),
        windowAfterResetsAt: null,
      });
      try {
        entry.model = await withAppServerClient(this.config, account.codexHome, (client) =>
          sendWarmupTurn(client, settings, work),
        );
      } catch (error) {
        entry.errorCode = safeWarmupError(error);
      }
      return entry;
    });
    if ("skipped" in attempt) return attempt;
    // Release the account lock before the shared refresh (it is not reentrant).
    let confirmed = false;
    try {
      await this.status.refresh(accountId);
      confirmed = true;
    } catch {
      /* Preserve the attempt, not an invented success. */
    }
    const after = this.database.accounts.get(accountId);
    const end = confirmed && after ? shortWindowEndsAt(after) : null;
    const entry = {
      ...attempt,
      outcome: (attempt.errorCode ? "failed" : end !== null ? "warmed" : "pending") as "failed" | "warmed" | "pending",
      errorCode: attempt.errorCode ?? (end === null ? "window_confirmation_pending" : null),
      durationMs: Date.now() - attempt.startedAt,
      windowAfterResetsAt: end,
    };
    this.database.warmupLog.finish(attempt.id, entry);
    return { ...entry, skipped: null };
  }

  private skipped(accountId: string, reason: WarmupSkipReason): WarmupAccountResult {
    return {
      accountId,
      outcome: "skipped",
      skipped: reason,
      errorCode: null,
      model: null,
      durationMs: null,
      windowBeforeResetsAt: null,
      windowAfterResetsAt: null,
    };
  }
}
