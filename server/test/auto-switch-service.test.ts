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
  opts: { weeklyUsed?: number | null; rank?: number | null; enrolled?: boolean; ready?: boolean } = {},
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
    primary: { usedPercent: 0, resetsAt: null, windowDurationMins: 300 },
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
  database.settings.update({ autoSwitch: { enabled: true, dryRun: false, ...patch } });
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

  it("records the decision but leaves routing alone in a dry run", () => {
    account("a", { weeklyUsed: 95, rank: 1 });
    account("b", { rank: 2 });
    active.select("a");
    database.settings.update({ autoSwitch: { enabled: true, dryRun: true, thresholdPercent: 25 } });

    expect(service.evaluate({ kind: "quota" })?.to).toBe("b");
    expect(active.get()?.id).toBe("a");
    const [entry] = database.accountSwitchLog.recent();
    expect(entry.dryRun).toBe(true);
    expect(entry.toAccountId).toBe("b");
    // A dry run must not start the dwell clock either, or the first real
    // switch would be held back by one that never happened.
    expect(database.accountSwitchLog.lastSwitchAt()).toBeNull();
  });

  it("switches and records when it is not a dry run", () => {
    account("a", { weeklyUsed: 95, rank: 1 });
    account("b", { rank: 2 });
    active.select("a");
    settings({ thresholdPercent: 25 });

    service.evaluate({ kind: "quota" });
    expect(active.get()?.id).toBe("b");
    const [entry] = database.accountSwitchLog.recent();
    expect(entry.dryRun).toBe(false);
    expect(entry.fromAccountId).toBe("a");
    expect(entry.reason).toBe("quota_below_threshold");
    expect(entry.evidence).toMatchObject({ thresholdPercent: 25 });
  });
});
