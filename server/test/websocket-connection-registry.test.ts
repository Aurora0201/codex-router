import { describe, expect, it, vi } from "vitest";
import { WebSocketConnectionRegistry } from "../src/proxy/websocket-connection-registry.js";

describe("WebSocketConnectionRegistry", () => {
  it("tracks connection states and removes closed connections", () => {
    const onChange = vi.fn();
    const registry = new WebSocketConnectionRegistry(onChange);
    const handle = registry.add({ connectionId: "connection-1", accountId: "account-1", connectedAt: 100 });

    expect(registry.list()).toEqual([{ connectionId: "connection-1", state: "connecting", connectedAt: 100 }]);
    handle.update("idle");
    handle.update("transmitting", { activeRequestId: "request-1", sessionId: "session-1", threadId: "thread-1", turnId: "turn-1", activityKind: "response" });
    expect(registry.list()[0]).toMatchObject({ state: "transmitting", activeRequestId: "request-1", sessionId: "session-1", threadId: "thread-1", turnId: "turn-1", activityKind: "response" });
    handle.update("idle");
    expect(registry.list()[0]).toEqual({ connectionId: "connection-1", state: "idle", connectedAt: 100, sessionId: "session-1", threadId: "thread-1", turnId: "turn-1" });
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
    older.update("transmitting", { activeRequestId: "request-1", activityKind: "response" });

    registry.retireAccount("shared");
    older.update("idle");

    expect(registry.list()).toEqual([
      { connectionId: "newer", state: "retiring", connectedAt: 200 },
      { connectionId: "older", state: "retiring", connectedAt: 100, activeRequestId: "request-1", activityKind: "response" },
    ]);
    expect(retireOlder).toHaveBeenCalledOnce();
    expect(retireNewer).toHaveBeenCalledOnce();
  });

  it("tracks prewarm and compaction activity while retaining the last turn when idle", () => {
    const registry = new WebSocketConnectionRegistry();
    const handle = registry.add({ connectionId: "connection-1", connectedAt: 100 });

    handle.update("transmitting", { sessionId: "session-1", threadId: "thread-1", turnId: "turn-1", activityKind: "prewarm" });
    expect(registry.list()[0]).toMatchObject({ activityKind: "prewarm", threadId: "thread-1", turnId: "turn-1" });
    expect(registry.list()[0]).not.toHaveProperty("activeRequestId");

    handle.update("transmitting", { activeRequestId: "request-1", sessionId: "session-1", threadId: "thread-1", turnId: "turn-1", activityKind: "compaction" });
    expect(registry.list()[0]).toMatchObject({ activityKind: "compaction", activeRequestId: "request-1" });

    handle.update("idle");
    expect(registry.list()[0]).toEqual({ connectionId: "connection-1", state: "idle", connectedAt: 100, sessionId: "session-1", threadId: "thread-1", turnId: "turn-1" });
  });

  it("merges handshake and frame identifiers without clearing known values", () => {
    const registry = new WebSocketConnectionRegistry();
    const handle = registry.add({ connectionId: "connection-1", connectedAt: 100, sessionId: "handshake-session", threadId: "handshake-thread" });
    expect(registry.list()[0]).toMatchObject({ state: "connecting", sessionId: "handshake-session", threadId: "handshake-thread" });

    handle.update("idle");
    handle.updateIdentifiers({ turnId: "frame-turn" });
    handle.update("transmitting", { activeRequestId: "request-1", threadId: "frame-thread", activityKind: "response" });
    expect(registry.list()[0]).toMatchObject({ sessionId: "handshake-session", threadId: "frame-thread", turnId: "frame-turn" });

    handle.update("idle");
    expect(registry.list()[0]).toMatchObject({ sessionId: "handshake-session", threadId: "frame-thread", turnId: "frame-turn" });
  });
});
