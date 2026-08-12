import { describe, expect, it } from "vitest";
import {
  inspectClientFrame,
  inspectServerFrame,
} from "../src/proxy/ws-metadata.js";
import { classifyProtocolTerminal } from "../src/proxy/request-classification.js";

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
    expect(classifyProtocolTerminal(failed.type!, failed.errorCode)).toMatchObject({ state: "failed", outcome: "upstream_error", protocolErrorCode: "rate_limit_exceeded" });
    expect(classifyProtocolTerminal("response.failed", "future_private_code")).toMatchObject({ outcome: "upstream_error", protocolErrorCode: "future_private_code" });
    expect(classifyProtocolTerminal("response.incomplete", "max_output_tokens")).toMatchObject({ outcome: "rejected", protocolErrorCode: "max_output_tokens" });
    expect(classifyProtocolTerminal("response.completed")).toEqual({ state: "completed", outcome: "success" });
  });
});
