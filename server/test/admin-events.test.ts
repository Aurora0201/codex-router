import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminEventHub } from "../src/api/admin/admin-events.js";

afterEach(() => vi.useRealTimers());

describe("AdminEventHub", () => {
  it("coalesces resource invalidations without carrying business data", () => {
    vi.useFakeTimers();
    const hub = new AdminEventHub();
    const listener = vi.fn();
    const unsubscribe = hub.subscribe(listener);

    hub.invalidate("stats");
    hub.invalidate("accounts", "stats");
    vi.advanceTimersByTime(100);

    expect(listener).toHaveBeenCalledOnce();
    expect(new Set(listener.mock.calls[0]?.[0])).toEqual(new Set(["stats", "accounts"]));
    unsubscribe();
    hub.invalidate("codex");
    vi.advanceTimersByTime(100);
    expect(listener).toHaveBeenCalledOnce();
    hub.close();
  });
});
