import type { GatewayDatabase } from "../db/database.js";
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

/** Percent of the weekly window still available, or null when unreported. */
function weeklyRemaining(account: AccountRecord): number | null {
  const windows = [
    { used: account.primaryUsedPercent, mins: account.primaryWindowMinutes },
    { used: account.secondaryUsedPercent, mins: account.secondaryWindowMinutes },
  ];
  // Which slot upstream puts the long window in has changed before, so it is
  // found by duration rather than by position.
  const weekly = windows.filter((w) => w.mins !== null).sort((a, b) => (b.mins ?? 0) - (a.mins ?? 0))[0];
  if (!weekly || weekly.used === null) return null;
  return Math.max(0, 100 - weekly.used);
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
      const remaining = weeklyRemaining(account);
      // An unreported window is not evidence of exhaustion; treat it as usable
      // rather than skipping an account the gateway simply has not read yet.
      return remaining === null || remaining >= settings.thresholdPercent;
    });

    const evidence = (target: AccountRecord): Record<string, unknown> => ({
      thresholdPercent: settings.thresholdPercent,
      currentRemainingPercent: current ? weeklyRemaining(current) : null,
      targetRemainingPercent: weeklyRemaining(target),
      trigger: trigger.kind,
    });

    if (healthy.length === 0) {
      if (settings.onAllBelow !== "highest") return null;
      const best = [...ranked]
        .filter((account) => trigger.kind === "quota" || account.id !== trigger.accountId)
        .sort((a, b) => (weeklyRemaining(b) ?? 0) - (weeklyRemaining(a) ?? 0))[0];
      if (!best || best.id === current?.id) return null;
      return { reason: this.reasonFor(trigger), from: current?.id ?? null, to: best.id, evidence: evidence(best) };
    }

    const target = healthy[0];
    if (current && target.id === current.id) return null;

    if (trigger.kind === "quota" && current && isRoutable(current)) {
      const remaining = weeklyRemaining(current);
      const currentIsFine = remaining === null || remaining >= settings.thresholdPercent;
      if (currentIsFine) {
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

  /**
   * Decide, record, and — unless this is a dry run — switch. Returns what was
   * decided so a caller can surface it.
   */
  evaluate(trigger: SwitchTrigger, now = Date.now()): SwitchDecision | null {
    const decision = this.decide(trigger, now);
    if (!decision) return null;
    const dryRun = this.database.settings.autoSwitch().dryRun;
    this.database.accountSwitchLog.record({
      switchedAt: now,
      fromAccountId: decision.from,
      toAccountId: decision.to,
      reason: decision.reason,
      dryRun,
      evidence: decision.evidence,
    });
    if (!dryRun) this.activeAccounts.select(decision.to);
    return decision;
  }

  private reasonFor(trigger: SwitchTrigger): SwitchReason {
    if (trigger.kind === "rate_limited") return "upstream_rate_limited";
    if (trigger.kind === "unavailable") return "account_unavailable";
    return "quota_below_threshold";
  }
}
