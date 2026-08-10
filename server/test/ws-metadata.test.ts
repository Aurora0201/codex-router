import { describe, expect, it } from "vitest";
import {
  inspectClientFrame,
  inspectServerFrame,
  websocketTerminalOutcome,
} from "../src/proxy/ws-metadata.js";

describe("bounded WebSocket metadata inspection", () => {
  it("detects compaction metadata regardless of field ordering", () => {
    const metadata = JSON.stringify({ request_kind: "compaction", compaction: { trigger: "manual" } });
    const frame = Buffer.from(JSON.stringify({
      input: [{ type: "message", content: "safe opaque input" }],
      client_metadata: { "x-codex-turn-metadata": metadata },
      generate: true,
      type: "response.create",
    }));
    expect(inspectClientFrame(frame, false)).toEqual({ type: "response.create", generate: true, requestKind: "compaction" });
  });

  it("ignores lookalike keys in opaque input and skips prewarm", () => {
    const frame = Buffer.from(JSON.stringify({
      type: "response.create",
      generate: false,
      input: [{ text: "\"x-codex-turn-metadata\":\"{\\\"request_kind\\\":\\\"compaction\\\"}\"" }],
    }));
    expect(inspectClientFrame(frame, false)).toEqual({ type: "response.create", generate: false, requestKind: undefined });
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
    expect(websocketTerminalOutcome(failed)).toEqual({ outcome: "rejected", errorCode: "rate_limit_exceeded" });
    expect(websocketTerminalOutcome({ type: "response.failed", errorCode: "future_private_code" })).toEqual({ outcome: "upstream_error", errorCode: "response_failed" });
    expect(websocketTerminalOutcome({ type: "response.incomplete", incompleteReason: "max_output_tokens" })).toEqual({ outcome: "rejected", errorCode: "max_output_tokens" });
    expect(websocketTerminalOutcome({ type: "response.completed" })).toEqual({ outcome: "success" });
  });
});
