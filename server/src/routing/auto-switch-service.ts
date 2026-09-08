import type { GatewayDatabase } from "../db/database.js";
import type { AutoSwitchSettings } from "../db/repositories/settings-repository.js";
import type { SwitchReason } from "../db/repositories/account-switch-log-repository.js";
import type { AccountRecord } from "../types.js";
import type { ActiveAccountService } from "./active-account-service.js";

/**
 * What made the gateway look at the pool again. The trigger decides whether a
 * threshold even applies: a 429 or a broken account is already proof that the
 * current one cannot serve, so those do not wait for a reading.
 */
export type SwitchTrigger =
  | { kind: "quota" }
  | { kind: "rate_limited"; accountId: string }
  | { kind: "unavailable"; accountId: string };

export interface SwitchDecision {
  reason: SwitchReason;
  from: string | null;
  to: string;
  evidence: Record<string, unknown>;
}

/** A day, in minutes: the line between the long window and the short one. */
const DAY_MINS = 24 * 60;

export type QuotaWindowRole = "long" | "short";

interface WatchedWindow {
  role: QuotaWindowRole;
  /** Percent still available, or null when upstream has not reported it. */
  remaining: number | null;
  threshold: number;
}

/**
 * The windows this account is judged on. Which slot upstream puts the week in
 * has changed before, so the role is read from the duration rather than from
 * the position.
 */
function watchedWindows(account: AccountRecord, settings: AutoSwitchSettings): WatchedWindow[] {
  const slots = [
    { used: account.primaryUsedPercent, mins: account.primaryWindowMinutes },
    { used: account.secondaryUsedPercent, mins: account.secondaryWindowMinutes },
  ].filter((slot) => slot.mins !== null);
  const remaining = (used: number | null) => (used === null ? null : Math.max(0, 100 - used));
  const pick = (want: QuotaWindowRole) => {
    const matches = slots.filter((slot) =>
      want === "long" ? (slot.mins ?? 0) >= DAY_MINS : (slot.mins ?? 0) < DAY_MINS,
    );
    // Longest of the long ones, shortest of the short ones: the tightest read
    // of each role rather than whichever came first.
    matches.sort((a, b) => (want === "long" ? (b.mins ?? 0) - (a.mins ?? 0) : (a.mins ?? 0) - (b.mins ?? 0)));
    return matches[0];
  };

  const windows: WatchedWindow[] = [];
  if (settings.switchOn !== "short") {
    const long = pick("long");
    if (long) windows.push({ role: "long", remaining: remaining(long.used), threshold: settings.thresholdPercent });
  }
  if (settings.switchOn !== "weekly") {
    const short = pick("short");
    if (short) {
      windows.push({ role: "short", remaining: remaining(short.used), threshold: settings.shortThresholdPercent });
    }
  }
  return windows;
}

/**
 * The window that is closest to its own threshold, which is what makes two
 * windows on different scales comparable. Null when nothing was reported —
 * not having read an account yet is not evidence that it is spent.
 */
function tightest(account: AccountRecord, settings: AutoSwitchSettings): WatchedWindow | null {
  const reported = watchedWindows(account, settings).filter((window) => window.remaining !== null);
  if (reported.length === 0) return null;
  return reported.sort(
    (a, b) => (a.remaining as number) - a.threshold - ((b.remaining as number) - b.threshold),
  )[0];
}

/** Every reported window is at or above its own threshold. */
function meetsThresholds(account: AccountRecord, settings: AutoSwitchSettings): boolean {
  const worst = tightest(account, settings);
  return worst === null || (worst.remaining as number) >= worst.threshold;
}

/** How much room is left before the first threshold is crossed. */
function headroom(account: AccountRecord, settings: AutoSwitchSettings): number {
  const worst = tightest(account, settings);
  return worst === null ? Number.POSITIVE_INFINITY : (worst.remaining as number) - worst.threshold;
}

function isRoutable(account: AccountRecord): boolean {
  return account.enabled && account.authStatus === "ready";
}

export class AutoSwitchService {
  constructor(
    private readonly database: GatewayDatabase,
    private readonly activeAccounts: ActiveAccountService,
  ) {}

  /** Priority order: ranked accounts first, then the rest by creation. */
  candidates(): AccountRecord[] {
    return this.database.accounts
      .list()
      .filter((account) => account.autoSwitchEnrolled && isRoutable(account))
      .sort((a, b) => {
        const left = a.autoSwitchRank ?? Number.MAX_SAFE_INTEGER;
        const right = b.autoSwitchRank ?? Number.MAX_SAFE_INTEGER;
        return left === right ? a.createdAt - b.createdAt : left - right;
      });
  }

  /**
   * Decides without acting, so the same reasoning serves the dry run and the
   * real thing — and so a test can ask what would happen.
   */
  decide(trigger: SwitchTrigger, now = Date.now()): SwitchDecision | null {
    const settings = this.database.settings.autoSwitch();
    if (!settings.enabled) return null;
    if (trigger.kind === "rate_limited" && !settings.triggerOn429) return null;
    if (trigger.kind === "unavailable" && !settings.triggerOnAuthFailure) return null;

    const current = this.activeAccounts.get();
    const ranked = this.candidates();
    if (ranked.length === 0) return null;

    // A switch retires connections, so flapping around the threshold costs
    // more than staying put a little longer.
    const lastSwitchAt = this.database.accountSwitchLog.lastSwitchAt();
    if (lastSwitchAt !== null && now - lastSwitchAt < settings.minDwellMs) return null;

    const healthy = ranked.filter((account) => {
      if (trigger.kind !== "quota" && account.id === trigger.accountId) return false;
      return meetsThresholds(account, settings);
    });

    const evidence = (target: AccountRecord): Record<string, unknown> => {
      const worst = current ? tightest(current, settings) : null;
      return {
        // The window that actually made the call, so the log can say "5 小时"
        // rather than leaving the reader to guess which number moved.
        window: worst?.role ?? (settings.switchOn === "short" ? "short" : "long"),
        thresholdPercent:
          worst?.threshold ??
          (settings.switchOn === "short" ? settings.shortThresholdPercent : settings.thresholdPercent),
        currentRemainingPercent: worst?.remaining ?? null,
        targetRemainingPercent: tightest(target, settings)?.remaining ?? null,
        trigger: trigger.kind,
      };
    };

    if (healthy.length === 0) {
      if (settings.onAllBelow !== "highest") return null;
      const best = [...ranked]
        .filter((account) => trigger.kind === "quota" || account.id !== trigger.accountId)
        .sort((a, b) => headroom(b, settings) - headroom(a, settings))[0];
      if (!best || best.id === current?.id) return null;
      return { reason: this.reasonFor(trigger), from: current?.id ?? null, to: best.id, evidence: evidence(best) };
    }

    const target = healthy[0];
    if (current && target.id === current.id) return null;

    if (trigger.kind === "quota" && current && isRoutable(current)) {
      if (meetsThresholds(current, settings)) {
        // The current account still serves. Only move for a better-ranked one,
        // and only when the user asked for that.
        if (!settings.switchBackToHigherPriority) return null;
        const currentRank = current.autoSwitchRank ?? Number.MAX_SAFE_INTEGER;
        const targetRank = target.autoSwitchRank ?? Number.MAX_SAFE_INTEGER;
        if (targetRank >= currentRank) return null;
        return {
          reason: "higher_priority_recovered",
          from: current.id,
          to: target.id,
          evidence: evidence(target),
        };
      }
    }

    return { reason: this.reasonFor(trigger), from: current?.id ?? null, to: target.id, evidence: evidence(target) };
  }

  /** Decide, record, and switch. Returns what was decided so a caller can say so. */
  evaluate(trigger: SwitchTrigger, now = Date.now()): SwitchDecision | null {
    const decision = this.decide(trigger, now);
    if (!decision) return null;
    this.database.accountSwitchLog.record({
      switchedAt: now,
      fromAccountId: decision.from,
      toAccountId: decision.to,
      reason: decision.reason,
      evidence: decision.evidence,
    });
    this.activeAccounts.select(decision.to);
    return decision;
  }

  /**
   * Switching is on, and there is nowhere left to go: every account in the
   * rotation is under its own threshold. Said out loud on the console, because
   * "暂停并提示" has to actually be a prompt.
   */
  stalled(): boolean {
    const settings = this.database.settings.autoSwitch();
    if (!settings.enabled) return false;
    const ranked = this.candidates();
    if (ranked.length === 0) return true;
    return ranked.every((account) => !meetsThresholds(account, settings));
  }

  private reasonFor(trigger: SwitchTrigger): SwitchReason {
    if (trigger.kind === "rate_limited") return "upstream_rate_limited";
    if (trigger.kind === "unavailable") return "account_unavailable";
    return "quota_below_threshold";
  }
}
