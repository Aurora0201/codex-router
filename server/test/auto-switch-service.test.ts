import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GatewayDatabase } from "../src/db/database.js";
import { ActiveAccountService } from "../src/routing/active-account-service.js";
import { AutoSwitchService } from "../src/routing/auto-switch-service.js";
import type { AutoSwitchSettings } from "../src/db/repositories/settings-repository.js";

let root: string;
let database: GatewayDatabase;
let active: ActiveAccountService;
let service: AutoSwitchService;

const WEEK = 10080;

function account(
  id: string,
  opts: {
    weeklyUsed?: number | null;
    shortUsed?: number | null;
    rank?: number | null;
    enrolled?: boolean;
    ready?: boolean;
  } = {},
) {
  database.accounts.insert({ id, codexHome: path.join(root, id) });
  database.accounts.update(id, {
    chatgptAccountId: id,
    authStatus: opts.ready === false ? "relogin_required" : "ready",
    autoSwitchRank: opts.rank ?? null,
    autoSwitchEnrolled: opts.enrolled ?? true,
  });
  const weekly =
    opts.weeklyUsed === undefined
      ? { usedPercent: 0, resetsAt: null, windowDurationMins: WEEK }
      : { usedPercent: opts.weeklyUsed, resetsAt: null, windowDurationMins: WEEK };
  database.accounts.updateRateLimits(id, {
    primary: { usedPercent: opts.shortUsed ?? 0, resetsAt: null, windowDurationMins: 300 },
    secondary: weekly,
    rateLimitReachedType: null,
    planType: "plus",
    buckets: [],
    defaultBucketKey: null,
    resetCredits: null,
    loadedAt: Date.now(),
  });
  return id;
}

function settings(patch: Partial<AutoSwitchSettings>) {
  database.settings.update({ autoSwitch: { enabled: true, ...patch } });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "auto-switch-"));
  database = new GatewayDatabase(path.join(root, "gateway.db"));
  active = new ActiveAccountService(database);
  service = new AutoSwitchService(database, active);
});

afterEach(async () => {
  database.raw.close();
  await rm(root, { recursive: true, force: true });
});

describe("AutoSwitchService", () => {
  it("does nothing at all while it is switched off", () => {
    account("a", { weeklyUsed: 99, rank: 1 });
    account("b", { rank: 2 });
    active.select("a");
    expect(service.decide({ kind: "quota" })).toBeNull();
  });

  it("moves off an account that fell below the threshold", () => {
    account("a", { weeklyUsed: 95, rank: 1 });
    account("b", { weeklyUsed: 10, rank: 2 });
    active.select("a");
    settings({ thresholdPercent: 25 });

    const decision = service.decide({ kind: "quota" });
    expect(decision?.to).toBe("b");
    expect(decision?.reason).toBe("quota_below_threshold");
    expect(decision?.evidence.currentRemainingPercent).toBe(5);
  });

  it("stays put while the routed account is still above the threshold", () => {
    account("a", { weeklyUsed: 10, rank: 1 });
    account("b", { rank: 2 });
    active.select("a");
    settings({ thresholdPercent: 25 });
    expect(service.decide({ kind: "quota" })).toBeNull();
  });

  it("follows the priority order rather than picking the fullest", () => {
    account("a", { weeklyUsed: 95, rank: 1 });
    account("full", { weeklyUsed: 0, rank: 3 });
    account("b", { weeklyUsed: 40, rank: 2 });
    active.select("a");
    settings({ thresholdPercent: 25 });
    // b is next in line and has enough; the emptier account does not jump it.
    expect(service.decide({ kind: "quota" })?.to).toBe("b");
  });

  it("skips accounts kept out of the rotation", () => {
    account("a", { weeklyUsed: 95, rank: 1 });
    account("team", { rank: 2, enrolled: false });
    account("c", { rank: 3 });
    active.select("a");
    settings({ thresholdPercent: 25 });
    expect(service.decide({ kind: "quota" })?.to).toBe("c");
  });

  it("skips accounts that cannot serve", () => {
    account("a", { weeklyUsed: 95, rank: 1 });
    account("broken", { rank: 2, ready: false });
    account("c", { rank: 3 });
    active.select("a");
    settings({ thresholdPercent: 25 });
    expect(service.decide({ kind: "quota" })?.to).toBe("c");
  });

  it("treats an unreported window as usable rather than as empty", () => {
    account("a", { weeklyUsed: 95, rank: 1 });
    account("unknown", { weeklyUsed: null, rank: 2 });
    active.select("a");
    settings({ thresholdPercent: 25 });
    // Not having read an account yet is not evidence of exhaustion, and
    // skipping it would strand the user on a spent one.
    expect(service.decide({ kind: "quota" })?.to).toBe("unknown");
  });

  it("leaves the current account alone when every candidate is also low", () => {
    account("a", { weeklyUsed: 90, rank: 1 });
    account("b", { weeklyUsed: 95, rank: 2 });
    active.select("a");
    settings({ thresholdPercent: 25, onAllBelow: "stay" });
    expect(service.decide({ kind: "quota" })).toBeNull();
  });

  it("falls back to whichever has most left when asked to", () => {
    account("a", { weeklyUsed: 95, rank: 1 });
    account("b", { weeklyUsed: 80, rank: 2 });
    account("c", { weeklyUsed: 90, rank: 3 });
    active.select("a");
    settings({ thresholdPercent: 25, onAllBelow: "highest" });
    expect(service.decide({ kind: "quota" })?.to).toBe("b");
  });

  it("reads only the week when the week is what it was pointed at", () => {
    account("a", { shortUsed: 98, rank: 1 });
    account("b", { rank: 2 });
    active.select("a");
    settings({ switchOn: "weekly", thresholdPercent: 25 });
    // The 5-hour window is spent, but the week is what decides here.
    expect(service.decide({ kind: "quota" })).toBeNull();
  });

  it("reads only the 5-hour window when that is what it was pointed at", () => {
    account("a", { weeklyUsed: 95, shortUsed: 0, rank: 1 });
    account("b", { weeklyUsed: 90, rank: 2 });
    active.select("a");
    settings({ switchOn: "short", shortThresholdPercent: 15 });
    // The week is nearly gone on both, and on this setting neither week counts.
    expect(service.decide({ kind: "quota" })).toBeNull();
  });

  it("moves off an account whose 5-hour window ran out", () => {
    account("a", { shortUsed: 95, rank: 1 });
    account("b", { rank: 2 });
    active.select("a");
    settings({ switchOn: "short", shortThresholdPercent: 15 });

    const decision = service.decide({ kind: "quota" });
    expect(decision?.to).toBe("b");
    // The log has to say which of the two numbers moved.
    expect(decision?.evidence).toMatchObject({ window: "short", thresholdPercent: 15, currentRemainingPercent: 5 });
  });

  it("keeps the two windows on their own thresholds when watching both", () => {
    // 20% left on the short window clears its 15% bar; the same 20% on the
    // week would not clear the week's 25%.
    account("a", { shortUsed: 80, rank: 1 });
    account("b", { rank: 2 });
    active.select("a");
    settings({ switchOn: "both", thresholdPercent: 25, shortThresholdPercent: 15 });
    expect(service.decide({ kind: "quota" })).toBeNull();
  });

  it("will not land on an account whose 5-hour window is also spent", () => {
    account("a", { shortUsed: 95, rank: 1 });
    account("alsoSpent", { shortUsed: 92, rank: 2 });
    account("c", { rank: 3 });
    active.select("a");
    settings({ switchOn: "both", thresholdPercent: 25, shortThresholdPercent: 15 });
    expect(service.decide({ kind: "quota" })?.to).toBe("c");
  });

  it("ranks the fallback by whichever window is closest to its own threshold", () => {
    // b is worse on the week; c is worse against the bar it has to clear.
    account("a", { weeklyUsed: 95, rank: 1 });
    account("b", { weeklyUsed: 80, rank: 2 });
    account("c", { weeklyUsed: 78, shortUsed: 90, rank: 3 });
    active.select("a");
    settings({
      switchOn: "both",
      thresholdPercent: 25,
      shortThresholdPercent: 15,
      onAllBelow: "highest",
    });
    expect(service.decide({ kind: "quota" })?.to).toBe("b");
  });

  it("still honours the boolean an older console saved", () => {
    account("a", { shortUsed: 95, rank: 1 });
    account("b", { rank: 2 });
    active.select("a");
    // watchShortWindow meant "the week, and also the short window".
    database.settings.update({
      autoSwitch: { enabled: true, watchShortWindow: true, shortThresholdPercent: 15 },
    });
    expect(database.settings.autoSwitch().switchOn).toBe("both");
    expect(service.decide({ kind: "quota" })?.to).toBe("b");
  });

  it("switches away from the account upstream just rate-limited", () => {
    account("a", { rank: 1 });
    account("b", { rank: 2 });
    active.select("a");
    settings({ thresholdPercent: 25 });
    // "a" still reads as full: the 429 is the evidence, not the reading.
    const decision = service.decide({ kind: "rate_limited", accountId: "a" });
    expect(decision?.to).toBe("b");
    expect(decision?.reason).toBe("upstream_rate_limited");
  });

  it("moves off an account that can no longer serve", () => {
    account("a", { rank: 1 });
    account("b", { rank: 2 });
    active.select("a");
    settings({ triggerOnAuthFailure: true });
    // The quota is untouched; losing auth is its own evidence.
    database.accounts.update("a", { authStatus: "relogin_required" });

    const decision = service.decide({ kind: "unavailable", accountId: "a" });
    expect(decision?.to).toBe("b");
    expect(decision?.reason).toBe("account_unavailable");
    // No window decided this, so the log must not name one.
    expect(decision?.evidence).toMatchObject({ window: null, thresholdPercent: null, trigger: "unavailable" });
  });

  it("honours the triggers that were turned off", () => {
    account("a", { rank: 1 });
    account("b", { rank: 2 });
    active.select("a");
    settings({ triggerOn429: false, triggerOnAuthFailure: false });
    expect(service.decide({ kind: "rate_limited", accountId: "a" })).toBeNull();
    expect(service.decide({ kind: "unavailable", accountId: "a" })).toBeNull();
  });

  it("will not switch again inside the dwell window", () => {
    account("a", { weeklyUsed: 95, rank: 1 });
    account("b", { weeklyUsed: 90, rank: 2 });
    account("c", { weeklyUsed: 0, rank: 3 });
    active.select("a");
    settings({ thresholdPercent: 25, minDwellMs: 5 * 60_000 });

    const now = Date.now();
    expect(service.evaluate({ kind: "quota" }, now)?.to).toBe("c");

    // c runs down too, so a further switch is warranted on the reading alone.
    database.accounts.updateRateLimits("c", {
      primary: { usedPercent: 0, resetsAt: null, windowDurationMins: 300 },
      secondary: { usedPercent: 98, resetsAt: null, windowDurationMins: WEEK },
      rateLimitReachedType: null,
      planType: "plus",
      buckets: [],
      defaultBucketKey: null,
      resetCredits: null,
      loadedAt: Date.now(),
    });

    // Each switch retires connections, so one is not allowed to follow another
    // straight away even when the reading says it should.
    expect(service.decide({ kind: "quota" }, now + 60_000)).toBeNull();
    expect(service.decide({ kind: "quota" }, now + 6 * 60_000)?.to).toBe("b");
  });

  it("only returns to a better-ranked account when asked", () => {
    account("best", { rank: 1 });
    account("current", { rank: 2 });
    active.select("current");

    settings({ thresholdPercent: 25, switchBackToHigherPriority: false });
    expect(service.decide({ kind: "quota" })).toBeNull();

    settings({ thresholdPercent: 25, switchBackToHigherPriority: true });
    const decision = service.decide({ kind: "quota" });
    expect(decision?.to).toBe("best");
    expect(decision?.reason).toBe("higher_priority_recovered");
  });

  it("keeps a partial change from resetting everything it did not name", () => {
    account("a", { rank: 1 });
    database.settings.patchAutoSwitch({ enabled: true, thresholdPercent: 40 });
    // The console saves one field at a time; the row is replaced whole, so a
    // second save used to put `enabled` back to its default.
    database.settings.patchAutoSwitch({ switchOn: "short" });
    expect(database.settings.autoSwitch()).toMatchObject({
      enabled: true,
      thresholdPercent: 40,
      switchOn: "short",
    });
  });

  it("switches and records", () => {
    account("a", { weeklyUsed: 95, rank: 1 });
    account("b", { rank: 2 });
    active.select("a");
    settings({ thresholdPercent: 25 });

    service.evaluate({ kind: "quota" });
    expect(active.get()?.id).toBe("b");
    const [entry] = database.accountSwitchLog.recent();
    expect(entry.fromAccountId).toBe("a");
    expect(entry.reason).toBe("quota_below_threshold");
    expect(entry.evidence).toMatchObject({ thresholdPercent: 25 });
  });
});

describe("AutoSwitchService.stalled", () => {
  it("says nothing while it is switched off", () => {
    account("a", { weeklyUsed: 99, rank: 1 });
    expect(service.stalled()).toBe(false);
  });

  it("says so once every account in the rotation is under its threshold", () => {
    account("a", { weeklyUsed: 95, rank: 1 });
    account("b", { weeklyUsed: 90, rank: 2 });
    active.select("a");
    settings({ thresholdPercent: 25, onAllBelow: "pause" });
    expect(service.stalled()).toBe(true);
  });

  it("stays quiet while one of them still has room", () => {
    account("a", { weeklyUsed: 95, rank: 1 });
    account("b", { weeklyUsed: 10, rank: 2 });
    active.select("a");
    settings({ thresholdPercent: 25, onAllBelow: "pause" });
    expect(service.stalled()).toBe(false);
  });
  it("never switches onto an account whose week is spent", () => {
    const current = account("current", { shortUsed: 99, weeklyUsed: 50, rank: 0 });
    account("spent", { shortUsed: 0, weeklyUsed: 100, rank: 1 });
    const roomy = account("roomy", { shortUsed: 10, weeklyUsed: 20, rank: 2 });
    settings({ switchOn: "short", shortThresholdPercent: 5 });
    active.select(current);

    // On the five-hour window alone the spent account reads as completely free.
    // Switching onto it was answered by the upstream with a 429.
    expect(service.decide({ kind: "quota" })?.to).toBe(roomy);
  });

  it("counts a spent week as nowhere left to go", () => {
    const current = account("current", { shortUsed: 99, weeklyUsed: 50, rank: 0 });
    account("spent", { shortUsed: 0, weeklyUsed: 100, rank: 1 });
    settings({ switchOn: "short", shortThresholdPercent: 5 });
    active.select(current);

    expect(service.stalled()).toBe(true);
  });
});
