import { describe, expect, it } from "vitest";
import { transportErrorEvidence } from "../src/proxy/transport-error.js";

describe("transport error evidence", () => {
  it("preserves a safe error cause chain and selects the deepest code", () => {
    const error = Object.assign(new Error("must not be persisted"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
      hostname: "private.example",
      cause: Object.assign(new Error("also secret"), { code: "ETIMEDOUT" }),
    });

    expect(transportErrorEvidence(error)).toEqual({
      diagnosticCode: "ETIMEDOUT",
      transportErrorChain: [
        { name: "Error", code: "UND_ERR_CONNECT_TIMEOUT" },
        { name: "Error", code: "ETIMEDOUT" },
      ],
    });
    expect(JSON.stringify(transportErrorEvidence(error))).not.toContain("secret");
    expect(JSON.stringify(transportErrorEvidence(error))).not.toContain(
      "private.example",
    );
  });

  it.each(["ECONNRESET", "ENOTFOUND"])("keeps the %s code", (code) => {
    expect(transportErrorEvidence(Object.assign(new Error(), { code }))).toEqual({
      diagnosticCode: code,
      transportErrorChain: [{ name: "Error", code }],
    });
  });

  it("bounds, sanitizes, and breaks cyclic cause chains", () => {
    const root: Record<string, unknown> = {
      name: "Error",
      code: "SAFE_ROOT",
      message: "sensitive",
    };
    let current = root;
    for (let index = 1; index <= 6; index++) {
      const cause: Record<string, unknown> = {
        name: index === 2 ? "unsafe name" : `Error${index}`,
        code: index === 3 ? "x".repeat(65) : `CODE_${index}`,
      };
      current.cause = cause;
      current = cause;
    }
    current.cause = root;

    const evidence = transportErrorEvidence(root);
    expect(evidence.transportErrorChain).toHaveLength(5);
    expect(evidence.transportErrorChain?.[2]).toEqual({ code: "CODE_2" });
    expect(evidence.transportErrorChain?.[3]).toEqual({ name: "Error3" });
    expect(evidence.diagnosticCode).toBe("CODE_4");
    expect(JSON.stringify(evidence)).not.toContain("sensitive");
  });

  it("falls back when no safe structured code exists", () => {
    expect(transportErrorEvidence(new Error("hidden"))).toEqual({
      diagnosticCode: "upstream_request_failed",
      transportErrorChain: [{ name: "Error" }],
    });
    expect(transportErrorEvidence("failure text")).toEqual({
      diagnosticCode: "upstream_request_failed",
    });
    const hostile = {};
    Object.defineProperty(hostile, "code", {
      get() {
        throw new Error("getter must not escape");
      },
    });
    expect(transportErrorEvidence(hostile)).toEqual({
      diagnosticCode: "upstream_request_failed",
    });
  });
});
