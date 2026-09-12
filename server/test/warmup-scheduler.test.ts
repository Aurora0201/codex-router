import { afterEach, describe, expect, it, vi } from "vitest";
import { WarmupScheduler } from "../src/accounts/warmup-scheduler.js";

afterEach(() => vi.useRealTimers());

function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const account = { id: "a", enabled: true, primaryWindowMinutes: 300, primaryUsedPercent: 0, primaryResetsAt: null };
  let auto = true;
  let busy = false;
  let scheduler: WarmupScheduler;
  const status = { refreshInBackground: vi.fn(async (id: string) => { scheduler.onStatus(id, true); return true; }) };
  const warmup = {
    isRunning: () => busy,
    autoTargets: () => [account],
    run: vi.fn(async (options) => { busy = true; await Promise.resolve(); busy = false; return { trigger: options.trigger, startedAt: Date.now(), results: [] }; }),
    close: vi.fn(async () => undefined),
  };
  const database = { accounts: { list: () => [account], get: () => account }, settings: { warmup: () => ({ auto }) } };
  scheduler = new WarmupScheduler(database as never, status as never, warmup as never, () => undefined);
  return { scheduler, status, warmup, account, setAuto: (value: boolean) => { auto = value; } };
}

describe("warm-up scheduler", () => {
  it("merges events arriving during a manual run and evaluates them afterward", async () => {
    const f = fixture();
    f.setAuto(false);
    f.scheduler.start();
    await vi.advanceTimersByTimeAsync(1);
    const gate = Promise.withResolvers<void>();
    f.warmup.run.mockImplementationOnce(async (options) => {
      await gate.promise;
      return { trigger: options.trigger, startedAt: Date.now(), results: [] };
    });
    const isRunning = vi.spyOn(f.warmup, "isRunning").mockReturnValue(true);
    const task = f.scheduler.run({ trigger: "manual" });
    f.setAuto(true);
    f.scheduler.onStatus("a", true);
    f.scheduler.onStatus("a", true);
    expect(f.warmup.run).toHaveBeenCalledTimes(1);
    isRunning.mockReturnValue(false);
    gate.resolve();
    await task;
    await Promise.resolve();
    expect(f.warmup.run).toHaveBeenCalledTimes(2);
    expect(f.warmup.run).toHaveBeenLastCalledWith({ trigger: "auto", accountIds: ["a"] });
    await f.scheduler.close();
  });
  it("refreshes at startup and warms only the freshly observed account", async () => {
    const f = fixture();
    f.scheduler.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.status.refreshInBackground).toHaveBeenCalledWith("a");
    expect(f.warmup.run).toHaveBeenCalledWith({ trigger: "auto", accountIds: ["a"] });
    await f.scheduler.close();
  });
  it("refreshes near the known expiry rather than waiting for the five-minute sweep", async () => {
    const f = fixture();
    f.setAuto(false);
    f.account.primaryUsedPercent = 30;
    f.account.primaryResetsAt = Date.now() + 60_000;
    f.scheduler.start();
    await vi.advanceTimersByTimeAsync(1);
    f.status.refreshInBackground.mockClear();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(f.status.refreshInBackground).toHaveBeenCalledTimes(1);
    await f.scheduler.close();
  });
  it("rechecks on settings changes and stops scheduling after close", async () => {
    const f = fixture();
    f.setAuto(false);
    f.scheduler.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.warmup.run).not.toHaveBeenCalled();
    f.setAuto(true);
    f.scheduler.refresh();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.warmup.run).toHaveBeenCalledTimes(1);
    await f.scheduler.close();
    f.status.refreshInBackground.mockClear();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(f.status.refreshInBackground).not.toHaveBeenCalled();
  });
  it("detects resume via a wall-clock gap", async () => {
    const f = fixture();
    f.setAuto(false);
    f.scheduler.start();
    await vi.advanceTimersByTimeAsync(1);
    f.status.refreshInBackground.mockClear();
    vi.setSystemTime(Date.now() + 3_600_000);
    await vi.advanceTimersByTimeAsync(30_001);
    expect(f.status.refreshInBackground).toHaveBeenCalled();
    await f.scheduler.close();
  });
});
