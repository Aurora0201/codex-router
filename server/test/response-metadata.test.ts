import { describe, expect, it } from "vitest";
import { safeResponseMetadata } from "../src/proxy/response-metadata.js";

describe("safe response metadata", () => {
  it("keeps only diagnostic headers and prefers x-request-id", () => {
    expect(safeResponseMetadata({
      "x-request-id": ["request-a", "request-b"],
      "openai-request-id": "fallback",
      "retry-after": "30",
      authorization: "secret",
      "set-cookie": "secret",
      "x-private": "secret",
    })).toEqual({
      upstreamRequestId: "request-a",
      diagnosticHeaders: {
        "x-request-id": "request-a",
        "openai-request-id": "fallback",
        "retry-after": "30",
      },
    });
  });

  it("uses the fallback request ID when the preferred header is absent", () => {
    expect(safeResponseMetadata({ "openai-request-id": "fallback" }).upstreamRequestId).toBe("fallback");
  });

  it("does not invent evidence for missing headers", () => {
    expect(safeResponseMetadata({ cookie: "secret" })).toEqual({
      upstreamRequestId: undefined,
      diagnosticHeaders: undefined,
    });
  });
});
