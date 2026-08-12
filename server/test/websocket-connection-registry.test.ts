import { describe, expect, it, vi } from "vitest";
import { WebSocketConnectionRegistry } from "../src/proxy/websocket-connection-registry.js";

describe("WebSocketConnectionRegistry", () => {
  it("tracks connection states and removes closed connections", () => {
    const onChange = vi.fn();
    const registry = new WebSocketConnectionRegistry(onChange);
    const handle = registry.add({ connectionId: "connection-1", accountId: "account-1", connectedAt: 100 });

    expect(registry.list()).toEqual([{ connectionId: "connection-1", state: "connecting", connectedAt: 100 }]);
    handle.update("idle");
    handle.update("transmitting", "request-1");
    expect(registry.list()[0]).toMatchObject({ state: "transmitting", activeRequestId: "request-1" });
    handle.update("idle");
    expect(registry.list()[0]).toEqual({ connectionId: "connection-1", state: "idle", connectedAt: 100 });
    handle.remove();
    expect(registry.list()).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(5);
  });

  it("keeps retiring authoritative and supports multiple connections per account", () => {
    const registry = new WebSocketConnectionRegistry();
    const older = registry.add({ connectionId: "older", accountId: "shared", connectedAt: 100 });
    const newer = registry.add({ connectionId: "newer", accountId: "shared", connectedAt: 200 });
    const retireOlder = vi.fn();
    const retireNewer = vi.fn();
    older.setRetire(retireOlder);
    newer.setRetire(retireNewer);
    older.update("transmitting", "request-1");

    registry.retireAccount("shared");
    older.update("idle");

    expect(registry.list()).toEqual([
      { connectionId: "newer", state: "retiring", connectedAt: 200 },
      { connectionId: "older", state: "retiring", connectedAt: 100, activeRequestId: "request-1" },
    ]);
    expect(retireOlder).toHaveBeenCalledOnce();
    expect(retireNewer).toHaveBeenCalledOnce();
  });
});
