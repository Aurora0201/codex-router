import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AccountRecord, GatewayConfig } from "../types.js";
import type { GatewayDatabase } from "../db/database.js";
import type { WarmupTrigger } from "../db/repositories/warmup-log-repository.js";
import { AppServerClient, withAppServerClient } from "./app-server-client.js";
import type { AccountStatusService } from "./account-status-service.js";

/** A model the user can pick for the warm-up turn. */
export interface WarmupModel {
  id: string;
  displayName: string;
  isDefault: boolean;
  /** Which reasoning efforts this model takes, in the catalog's own order. */
  efforts: { id: string; description: string }[];
  defaultEffort: string | null;
}

export type WarmupSkipReason = "window_running" | "cooldown" | "daily_limit" | "not_enrolled" | "not_ready";

export interface WarmupAccountResult {
  accountId: string;
  outcome: "warmed" | "skipped" | "failed";
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

/** One turn is a handful of seconds; a minute and a half means it is stuck. */
const TURN_TIMEOUT_MS = 90_000;
const DAY_MS = 24 * 3_600_000;
/** Anything shorter than a day is the window that stops the next request. */
const SHORT_WINDOW_MAX_MINS = 1440;

/**
 * Upstream messages can carry prompt or response text, which never reaches the
 * database. What is stored is a classification, the same way a failed status
 * check stores one.
 */
function safeWarmupError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (/unauthor|\b401\b|relogin|refresh.?token|login.?required/.test(message)) return "relogin_required";
  if (/\b429\b|rate.?limit|quota|usage.?limit/.test(message)) return "rate_limited";
  if (/timeout|timed out/.test(message)) return "timeout";
  if (/model/.test(message)) return "model_unavailable";
  if (/codex_app_server_(exited|closed|not_started)/.test(message)) return "app_server_unavailable";
  return "warmup_failed";
}

function object(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * The reset timestamp of the account's short window, or null when there is no
 * short window on record. A window that has already passed its reset is not
 * running any more, which is the whole reason this feature exists.
 */
export function shortWindowResetsAt(account: AccountRecord): number | null {
  const windows = [
    { mins: account.primaryWindowMinutes, resetsAt: account.primaryResetsAt },
    { mins: account.secondaryWindowMinutes, resetsAt: account.secondaryResetsAt },
  ];
  const short = windows.find((w) => typeof w.mins === "number" && w.mins > 0 && w.mins < SHORT_WINDOW_MAX_MINS);
  return short?.resetsAt ?? null;
}

/** True when the short window is still counting, so warming it would buy nothing. */
export function shortWindowRunning(account: AccountRecord, now = Date.now()): boolean {
  const resetsAt = shortWindowResetsAt(account);
  return resetsAt !== null && resetsAt > now;
}

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
  ) {}

  close(): void {
    this.closed = true;
  }

  currentProgress(): WarmupProgress {
    return { ...this.progress };
  }

  /** Enrolled, enabled and authenticated: the accounts warm-up may touch at all. */
  candidates(): AccountRecord[] {
    return this.database.accounts
      .list()
      .filter((account) => account.warmupEnrolled && account.enabled && account.authStatus === "ready");
  }

  /** Of those, the ones whose short window is not already counting. */
  pending(now = Date.now()): AccountRecord[] {
    return this.candidates().filter((account) => !shortWindowRunning(account, now));
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
    const account = this.candidates()[0] ?? this.database.accounts.list().find((a) => a.enabled && a.authStatus === "ready");
    if (!account) return [];
    return withAppServerClient(this.config, account.codexHome, async (client) => {
      const result = object(await client.call("model/list", { includeHidden: false }, 30_000));
      const data = Array.isArray(result.data) ? result.data : [];
      return data.map((entry) => {
        const model = object(entry);
        const id = typeof model.id === "string" ? model.id : "";
        const efforts = Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [];
        return {
          id,
          displayName: typeof model.displayName === "string" ? model.displayName : id,
          isDefault: model.isDefault === true,
          efforts: efforts.map((value) => {
            const effort = object(value);
            return {
              id: typeof effort.reasoningEffort === "string" ? effort.reasoningEffort : "",
              description: typeof effort.description === "string" ? effort.description : "",
            };
          }).filter((effort) => effort.id.length > 0),
          defaultEffort: typeof model.defaultReasoningEffort === "string" ? model.defaultReasoningEffort : null,
        };
      }).filter((model) => model.id.length > 0);
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

  private async runInner(options: { trigger: WarmupTrigger; force?: boolean; accountIds?: string[] }): Promise<WarmupRunResult> {
    const settings = this.database.settings.warmup();
    const startedAt = Date.now();
    const wanted = new Set(options.accountIds ?? []);
    const targets = this.candidates().filter((account) => wanted.size === 0 || wanted.has(account.id));
    const results: WarmupAccountResult[] = [];

    this.publish({ running: true, total: targets.length, done: 0, accountId: null });
    const work = await mkdtemp(path.join(os.tmpdir(), "codex-router-warmup-"));
    try {
      for (const account of targets) {
        if (this.closed) break;
        this.publish({ running: true, total: targets.length, done: results.length, accountId: account.id });
        const skip = this.skipReason(account, settings, options);
        if (skip) {
          results.push({
            accountId: account.id, outcome: "skipped", skipped: skip, errorCode: null,
            model: null, durationMs: null,
            windowBeforeResetsAt: shortWindowResetsAt(account), windowAfterResetsAt: null,
          });
          continue;
        }
        results.push(await this.warmOne(account, settings, options.trigger, work));
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
    // Forcing is a person deciding to spend anyway; the guards that exist to
    // stop the gateway spending on its own still apply to the automatic pass.
    if (!options.force && shortWindowRunning(account)) return "window_running";
    if (options.trigger === "manual" && options.force) return null;
    const last = this.database.warmupLog.lastAttemptAt(account.id);
    if (last !== null && Date.now() - last < settings.cooldownMs) return "cooldown";
    if (this.database.warmupLog.countSince(account.id, Date.now() - DAY_MS) >= settings.dailyLimit) return "daily_limit";
    return null;
  }

  private async warmOne(
    account: AccountRecord,
    settings: ReturnType<GatewayDatabase["settings"]["warmup"]>,
    trigger: WarmupTrigger,
    work: string,
  ): Promise<WarmupAccountResult> {
    const startedAt = Date.now();
    const windowBeforeResetsAt = shortWindowResetsAt(account);
    let model: string | null = null;
    let errorCode: string | null = null;

    try {
      model = await withAppServerClient(this.config, account.codexHome, (client) =>
        this.sendTurn(client, settings, work));
    } catch (error) {
      errorCode = safeWarmupError(error);
    }

    // Read the window back even when the turn failed: a 429 still says
    // something about where this account stands, and a turn that failed after
    // the model answered may well have started the window anyway.
    await this.status.refresh(account.id).catch(() => undefined);
    const after = this.database.accounts.get(account.id);
    const entry = {
      startedAt,
      accountId: account.id,
      trigger,
      outcome: (errorCode === null ? "warmed" : "failed") as "warmed" | "failed",
      model,
      durationMs: Date.now() - startedAt,
      errorCode,
      windowBeforeResetsAt,
      windowAfterResetsAt: after ? shortWindowResetsAt(after) : null,
    };
    this.database.warmupLog.record(entry);
    return { ...entry, skipped: null };
  }

  /** thread/start, then one turn, then wait for the turn to come back. */
  private async sendTurn(
    client: AppServerClient,
    settings: { model: string | null; effort: string | null; message: string },
    cwd: string,
  ): Promise<string | null> {
    const { model, effort, message } = settings;
    const thread = object(await client.call("thread/start", {
      ...(model ? { model } : {}),
      // A model this subscription cannot use falls back to the account's own
      // default rather than failing the warm-up over a picker choice.
      allowProviderModelFallback: true,
      cwd,
      sandbox: "read-only",
      approvalPolicy: "never",
    }, 60_000));
    const threadId = typeof thread.threadId === "string" ? thread.threadId : String(object(thread.thread).id ?? "");
    if (!threadId) throw new Error("warmup_thread_not_started");

    const completed = this.awaitTurn(client, threadId);
    try {
      const started = object(await client.call("turn/start", {
        threadId,
        input: [{ type: "text", text: message }],
        // Overrides the thread's effort for this turn. Omitted leaves the
        // model's own default, which is what "跟随模型默认" means.
        ...(effort ? { effort } : {}),
      }, 60_000));
      const usedModel = typeof started.model === "string" ? started.model : null;
      await completed;
      return usedModel ?? model;
    } finally {
      // Whatever happened, do not leave the thread holding the app-server open.
      await client.call("thread/archive", { threadId }, 10_000).catch(() => undefined);
    }
  }

  /**
   * `turn/start` returns as soon as the turn exists; completion arrives as a
   * notification, and a failed turn arrives on that same notification with a
   * status rather than as an error.
   */
  private awaitTurn(client: AppServerClient, threadId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        client.off("notification", listener);
        reject(new Error("warmup_turn_timeout"));
      }, TURN_TIMEOUT_MS);
      const listener = (method: string, params: unknown) => {
        if (method !== "turn/completed") return;
        const payload = object(params);
        if (payload.threadId !== threadId) return;
        client.off("notification", listener);
        clearTimeout(timer);
        const turn = object(payload.turn);
        if (turn.status === "completed") resolve();
        else reject(new Error(`warmup_turn_${String(turn.status ?? "unknown")}`));
      };
      client.on("notification", listener);
    });
  }
}
