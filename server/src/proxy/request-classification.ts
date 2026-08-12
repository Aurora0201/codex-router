import type { FailureSource, FailureStage, RequestOutcome, RequestState } from "../types.js";

export interface RequestEvidence {
  state: Exclude<RequestState, "running">;
  outcome: RequestOutcome;
  failureSource?: FailureSource;
  failureStage?: FailureStage;
  httpStatus?: number;
  protocolErrorCode?: string;
  diagnosticCode?: string;
  upstreamRequestId?: string;
  diagnosticHeaders?: Record<string, string>;
  transportErrorChain?: Array<{ name?: string; code?: string }>;
}

const REJECTED_PROTOCOL_CODES = new Set([
  "authentication_error", "context_length_exceeded", "cyber_policy",
  "insufficient_quota", "invalid_request_error", "permission_error",
]);

export function classifyHttpStatus(status: number): RequestEvidence {
  if (status >= 200 && status < 300) return { state: "completed", outcome: "success", httpStatus: status };
  if (status === 429 || status >= 500) return { state: "failed", outcome: "upstream_error", failureSource: "upstream_http", failureStage: "terminal", httpStatus: status };
  return { state: "rejected", outcome: "rejected", failureSource: "upstream_http", failureStage: status === 401 ? "authentication" : "terminal", httpStatus: status };
}

export function classifyProtocolTerminal(type: string, code?: string, status?: number): RequestEvidence | null {
  if (type === "response.completed") return { state: "completed", outcome: "success" };
  if (type === "response.incomplete") return { state: "rejected", outcome: "rejected", failureSource: "upstream_protocol", failureStage: "terminal", protocolErrorCode: code ?? "response_incomplete" };
  if (type === "response.failed") {
    const rejected = code ? REJECTED_PROTOCOL_CODES.has(code) : false;
    return { state: rejected ? "rejected" : "failed", outcome: rejected ? "rejected" : "upstream_error", failureSource: "upstream_protocol", failureStage: "terminal", protocolErrorCode: code ?? "response_failed_without_code" };
  }
  if (type === "error") {
    const byStatus = status === undefined ? undefined : classifyHttpStatus(status);
    return {
      state: byStatus?.state === "rejected" ? "rejected" : "failed",
      outcome: byStatus?.outcome === "rejected" ? "rejected" : "upstream_error",
      failureSource: "upstream_protocol",
      failureStage: "terminal",
      ...(status === undefined ? {} : { httpStatus: status }),
      protocolErrorCode: code ?? "top_level_error_without_code",
    };
  }
  return null;
}

export function gatewayFailure(code: string, status: number, stage: FailureStage = "routing"): RequestEvidence {
  return { state: "failed", outcome: "gateway_error", failureSource: "gateway", failureStage: stage, httpStatus: status, diagnosticCode: code };
}

export function transportFailure(code: string, stage: FailureStage = "streaming"): RequestEvidence {
  return { state: "failed", outcome: "upstream_error", failureSource: "transport", failureStage: stage, diagnosticCode: code };
}

export const clientCancellation = (): RequestEvidence => ({ state: "cancelled", outcome: "client_cancelled", failureSource: "client", failureStage: "streaming", diagnosticCode: "client_cancelled" });
