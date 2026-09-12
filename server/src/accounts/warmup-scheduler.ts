import type { GatewayDatabase } from "../db/database.js";
import type { AccountStatusService } from "./account-status-service.js";
import type { AccountWarmupService, WarmupRunResult } from "./account-warmup-service.js";
import { shortWindowEndsAt } from "./quota-windows.js";

const POLL_MS = 5 * 60_000;
type RunOptions = { trigger: "manual" | "auto"; force?: boolean; accountIds?: string[] };

/** Owns auto triggers and their tasks; it never chooses a routing account. */
export class WarmupScheduler {
  private readonly pending = new Set<string>();
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly nextRefresh = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private watchdog: NodeJS.Timeout | undefined;
  private started = false;
  private closed = false;
  private pumping = false;

  constructor(
    private readonly database: GatewayDatabase,
    private readonly status: AccountStatusService,
    private readonly warmup: AccountWarmupService,
    private readonly onFinished: (result?: WarmupRunResult) => void,
  ) {}

  start(): void {
    if (this.started || this.closed) return;
    this.started = true;
    let previous = Date.now();
    this.watchdog = setInterval(() => {
      const now = Date.now();
      // Sleep/resume and wall-clock adjustments invalidate scheduled readings.
      if (now - previous > 60_000 || now < previous) this.refresh();
      previous = now;
      // Login can create the first account while there is no scheduled timer.
      let added = false;
      for (const account of this.database.accounts.list()) {
        if (account.enabled && !this.nextRefresh.has(account.id)) {
          this.nextRefresh.set(account.id, 0);
          added = true;
        }
      }
      if (added) this.arm();
    }, 30_000);
    this.watchdog.unref();
    this.refresh();
  }

  /** Settings/enrollment changes also need a fresh read, not an old pool snapshot. */
  refresh(): void {
    if (!this.started || this.closed) return;
    for (const account of this.database.accounts.list()) {
      if (account.enabled) this.nextRefresh.set(account.id, 0);
    }
    this.arm();
  }

  onStatus(accountId: string, ok: boolean): void {
    if (!this.started || this.closed) return;
    const now = Date.now();
    const account = this.database.accounts.get(accountId);
    const end = account && shortWindowEndsAt(account, now);
    let next = now + POLL_MS;
    if (ok && end && end > now) next = Math.min(next, end + 1_000);
    this.nextRefresh.set(accountId, next);
    if (ok && this.database.settings.warmup().auto) this.pending.add(accountId);
    this.arm();
    this.pump();
  }

  run(options: RunOptions): Promise<void> {
    if (this.closed) return Promise.reject(new Error("warmup_service_closed"));
    const task = this.warmup.run(options).then((result) => this.onFinished(result)).finally(() => {
      this.pump();
    });
    return this.track(task);
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    clearInterval(this.watchdog);
    this.pending.clear();
    // Mark the service closed before draining so no later account can start.
    await this.warmup.close();
    await Promise.allSettled(this.tasks);
  }

  private track<T>(task: Promise<T>): Promise<T> {
    this.tasks.add(task);
    void task.finally(() => this.tasks.delete(task)).catch(() => undefined);
    return task;
  }

  private pump(): void {
    if (this.closed || this.pumping || this.warmup.isRunning()) return;
    if (!this.database.settings.warmup().auto) { this.pending.clear(); return; }
    const eligible = new Set(this.warmup.autoTargets().map((account) => account.id));
    const ids = [...this.pending].filter((id) => eligible.has(id));
    this.pending.clear();
    if (!ids.length) return;
    this.pumping = true;
    const task = this.run({ trigger: "auto", accountIds: ids }).catch(() => this.onFinished()).finally(() => {
      this.pumping = false;
      this.pump();
    });
    this.track(task);
  }

  private arm(): void {
    clearTimeout(this.timer);
    if (this.closed || !this.started) return;
    const enabled = new Set(this.database.accounts.list().filter((a) => a.enabled).map((a) => a.id));
    for (const id of this.nextRefresh.keys()) if (!enabled.has(id)) this.nextRefresh.delete(id);
    const next = Math.min(...this.nextRefresh.values());
    if (!Number.isFinite(next)) return;
    this.timer = setTimeout(() => {
      const now = Date.now();
      const due = [...this.nextRefresh].filter(([, at]) => at <= now).map(([id]) => id);
      for (const id of due) this.nextRefresh.set(id, now + POLL_MS);
      // Keep the same bounded concurrency as account status sweeps.
      let cursor = 0;
      const worker = async () => {
        while (!this.closed && cursor < due.length) await this.status.refreshInBackground(due[cursor++]);
      };
      this.track(Promise.all([worker(), worker()])).catch(() => this.onFinished());
      this.arm();
    }, Math.max(0, Math.min(next - Date.now(), POLL_MS)));
    this.timer.unref();
  }
}
