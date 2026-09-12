import { describe, expect, it } from "vitest";
import { classifyHttpCompletion, classifyHttpStatus } from "../src/proxy/request-classification.js";

describe("HTTP completion evidence", () => {
  it.each([200, 204, 401, 429, 503])("keeps HTTP classification without SSE inspection: %i", (status) => {
    expect(classifyHttpCompletion(status, null)).toEqual(classifyHttpStatus(status));
  });

  it.each([
    [false, "protocol_terminal_missing"],
    [true, "protocol_event_parse_failed"],
  ] as const)("does not treat HTTP 200 without a terminal as success (%s)", (parseFailed, diagnosticCode) => {
    expect(classifyHttpCompletion(200, { terminal: null, parseFailed })).toMatchObject({
      state: "failed", failureSource: "transport", failureStage: "terminal", diagnosticCode,
    });
  });

  it("uses a valid terminal even after an earlier parse failure", () => {
    expect(classifyHttpCompletion(200, { terminal: { type: "response.completed" }, parseFailed: true }))
      .toEqual({ state: "completed", outcome: "success" });
  });

  it("keeps incomplete reasons and unknown protocol codes", () => {
    expect(classifyHttpCompletion(200, {
      terminal: { type: "response.incomplete", incompleteReason: "max_output_tokens" }, parseFailed: false,
    })).toMatchObject({ state: "rejected", protocolErrorCode: "max_output_tokens" });
    expect(classifyHttpCompletion(200, {
      terminal: { type: "response.failed", errorCode: "new_upstream_code" }, parseFailed: false,
    })).toMatchObject({ state: "failed", protocolErrorCode: "new_upstream_code" });
  });

  it("preserves top-level error classification for the caller to merge HTTP metadata", () => {
    expect(classifyHttpCompletion(200, {
      terminal: { type: "error", status: 429, errorCode: "rate_limit" }, parseFailed: false,
    })).toMatchObject({ outcome: "upstream_error", httpStatus: 429, protocolErrorCode: "rate_limit" });
  });

  it("rejects an unrecognized terminal instead of inferring success", () => {
    expect(classifyHttpCompletion(200, { terminal: { type: "unknown" }, parseFailed: false }))
      .toMatchObject({ diagnosticCode: "protocol_terminal_unrecognized" });
  });
});
