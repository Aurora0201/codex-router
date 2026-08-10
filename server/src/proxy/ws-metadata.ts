import { JSONParser } from "@streamparser/json";
import type { RawData } from "ws";

const MAX_TURN_METADATA_BYTES = 8 * 1024;

const CLIENT_PATHS = [
  "$.type",
  "$.generate",
  "$.client_metadata.x-codex-turn-metadata",
];

const SERVER_PATHS = [
  "$.type",
  "$.response.error.code",
  "$.response.incomplete_details.reason",
];

const REJECTED_CODES = new Set([
  "authentication_error",
  "context_length_exceeded",
  "cyber_policy",
  "insufficient_quota",
  "invalid_request_error",
  "permission_error",
  "rate_limit_exceeded",
]);

const UPSTREAM_CODES = new Set(["server_error", "overloaded", "timeout"]);
const INCOMPLETE_REASONS = new Set(["max_output_tokens", "content_filter"]);

export interface ClientFrameMetadata {
  type?: string;
  generate?: boolean;
  requestKind?: string;
}

export interface ServerFrameMetadata {
  type?: string;
  errorCode?: string;
  incompleteReason?: string;
}

export function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function selectedValues(data: RawData, paths: string[]): Map<string, unknown> | null {
  const values = new Map<string, unknown>();
  let failed = false;
  try {
    const parser = new JSONParser({ paths, keepStack: false, stringBufferSize: 64 * 1024 });
    parser.onValue = ({ key, value }) => {
      if (typeof key === "string") values.set(key, value);
    };
    parser.onError = () => { failed = true; };
    parser.write(rawDataBuffer(data));
    if (!parser.isEnded) parser.end();
  } catch {
    return null;
  }
  return failed ? null : values;
}

function requestKind(value: unknown): string | undefined {
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX_TURN_METADATA_BYTES) return undefined;
  try {
    const parsed = JSON.parse(value) as { request_kind?: unknown };
    return typeof parsed.request_kind === "string" ? parsed.request_kind : undefined;
  } catch {
    return undefined;
  }
}

export function inspectClientFrame(data: RawData, isBinary: boolean): ClientFrameMetadata | null {
  if (isBinary) return null;
  const values = selectedValues(data, CLIENT_PATHS);
  if (!values) return null;
  return {
    type: typeof values.get("type") === "string" ? values.get("type") as string : undefined,
    generate: typeof values.get("generate") === "boolean" ? values.get("generate") as boolean : undefined,
    requestKind: requestKind(values.get("x-codex-turn-metadata")),
  };
}

export function inspectServerFrame(data: RawData, isBinary: boolean): ServerFrameMetadata | null {
  if (isBinary) return null;
  const values = selectedValues(data, SERVER_PATHS);
  if (!values) return null;
  return {
    type: typeof values.get("type") === "string" ? values.get("type") as string : undefined,
    errorCode: typeof values.get("code") === "string" ? values.get("code") as string : undefined,
    incompleteReason: typeof values.get("reason") === "string" ? values.get("reason") as string : undefined,
  };
}

export function websocketTerminalOutcome(metadata: ServerFrameMetadata): { outcome: "success" | "rejected" | "upstream_error"; errorCode?: string } | null {
  if (metadata.type === "response.completed") return { outcome: "success" };
  if (metadata.type === "response.incomplete") {
    return {
      outcome: "rejected",
      errorCode: metadata.incompleteReason && INCOMPLETE_REASONS.has(metadata.incompleteReason)
        ? metadata.incompleteReason
        : "response_incomplete",
    };
  }
  if (metadata.type !== "response.failed") return null;
  if (metadata.errorCode && REJECTED_CODES.has(metadata.errorCode)) {
    return { outcome: "rejected", errorCode: metadata.errorCode };
  }
  return {
    outcome: "upstream_error",
    errorCode: metadata.errorCode && UPSTREAM_CODES.has(metadata.errorCode) ? metadata.errorCode : "response_failed",
  };
}
