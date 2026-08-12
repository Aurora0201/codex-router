import { describe, expect, it } from "vitest";
import {
  inspectClientFrame,
  inspectHandshakeTurnMetadata,
  inspectServerFrame,
} from "../src/proxy/ws-metadata.js";
import { classifyProtocolTerminal } from "../src/proxy/request-classification.js";

describe("bounded WebSocket metadata inspection", () => {
  it("detects compaction metadata regardless of field ordering", () => {
    const metadata = JSON.stringify({ request_kind: "compaction", session_id: "session-1", thread_id: "thread-1", turn_id: "turn-1", compaction: { trigger: "manual" }, workspaces: { "sensitive/path": {} } });
    const frame = Buffer.from(JSON.stringify({
      input: [{ type: "message", content: "safe opaque input" }],
      client_metadata: { "x-codex-turn-metadata": metadata },
      generate: true,
      type: "response.create",
    }));
    expect(inspectClientFrame(frame, false)).toEqual({ type: "response.create", generate: true, requestKind: "compaction", sessionId: "session-1", threadId: "thread-1", turnId: "turn-1" });
  });

  it("ignores lookalike keys in opaque input and skips prewarm", () => {
    const frame = Buffer.from(JSON.stringify({
      type: "response.create",
      generate: false,
      input: [{ text: "\"x-codex-turn-metadata\":\"{\\\"request_kind\\\":\\\"compaction\\\"}\"" }],
    }));
    expect(inspectClientFrame(frame, false)).toEqual({ type: "response.create", generate: false });
  });

  it("drops unsafe turn identifiers without retaining other metadata", () => {
    const frame = Buffer.from(JSON.stringify({
      type: "response.create",
      client_metadata: { "x-codex-turn-metadata": JSON.stringify({
        session_id: "session ok",
        thread_id: "thread/unsafe",
        turn_id: "t".repeat(257),
        workspaces: { "C:/private/project": { remote: "secret" } },
      }) },
    }));
    expect(inspectClientFrame(frame, false)).toEqual({ type: "response.create", generate: undefined, requestKind: undefined, sessionId: undefined, threadId: undefined, turnId: undefined });
  });

  it("supports direct client metadata while nested metadata stays authoritative", () => {
    const frame = Buffer.from(JSON.stringify({
      type: "response.create",
      client_metadata: {
        session_id: "direct-session",
        thread_id: "direct-thread",
        turn_id: "direct-turn",
        "x-codex-turn-metadata": JSON.stringify({ thread_id: "nested-thread", turn_id: "nested-turn" }),
      },
    }));
    expect(inspectClientFrame(frame, false)).toMatchObject({
      sessionId: "direct-session",
      threadId: "nested-thread",
      turnId: "nested-turn",
    });
  });

  it("extracts safe handshake metadata and falls back to thread-id", () => {
    expect(inspectHandshakeTurnMetadata({
      "x-codex-turn-metadata": JSON.stringify({ session_id: "session-1", thread_id: "thread-1", turn_id: "turn-1", workspaces: { private: {} } }),
      "thread-id": "fallback-thread",
    })).toEqual({ sessionId: "session-1", threadId: "thread-1", turnId: "turn-1" });
    expect(inspectHandshakeTurnMetadata({ "thread-id": "fallback-thread" })).toEqual({ threadId: "fallback-thread" });
    expect(inspectHandshakeTurnMetadata({ "thread-id": "unsafe/thread" })).toEqual({ threadId: undefined });
  });

  it("rejects oversized or malformed metadata without rejecting the frame", () => {
    const oversized = Buffer.from(JSON.stringify({ type: "response.create", client_metadata: { "x-codex-turn-metadata": "x".repeat(8 * 1024 + 1) } }));
    expect(inspectClientFrame(oversized, false)?.requestKind).toBeUndefined();
    expect(inspectClientFrame(Buffer.from("not-json"), false)).toBeNull();
    expect(inspectClientFrame(Buffer.from("binary"), true)).toBeNull();
  });

  it("normalizes terminal events without retaining error messages", () => {
    const failed = inspectServerFrame(Buffer.from(JSON.stringify({
      type: "response.failed",
      response: { error: { code: "rate_limit_exceeded", message: "sensitive upstream message" } },
    })), false)!;
    expect(failed).toEqual({ type: "response.failed", errorCode: "rate_limit_exceeded", incompleteReason: undefined });
    expect(classifyProtocolTerminal(failed.type!, failed.errorCode)).toMatchObject({ state: "failed", outcome: "upstream_error", protocolErrorCode: "rate_limit_exceeded" });
    expect(classifyProtocolTerminal("response.failed", "future_private_code")).toMatchObject({ outcome: "upstream_error", protocolErrorCode: "future_private_code" });
    expect(classifyProtocolTerminal("response.incomplete", "max_output_tokens")).toMatchObject({ outcome: "rejected", protocolErrorCode: "max_output_tokens" });
    expect(classifyProtocolTerminal("response.completed")).toEqual({ state: "completed", outcome: "success" });
  });
});
