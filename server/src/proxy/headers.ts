import type { IncomingHttpHeaders } from "node:http";
import type { CredentialSnapshot } from "../types.js";

const REQUEST_BLOCKLIST = new Set([
  "authorization", "chatgpt-account-id", "x-openai-fedramp", "cookie", "host",
  "connection", "proxy-connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "content-length",
]);

const PASSTHROUGH_REQUEST_BLOCKLIST = new Set([
  "cookie", "host", "connection", "proxy-connection", "keep-alive",
  "proxy-authenticate", "proxy-authorization", "te", "trailer",
  "transfer-encoding", "upgrade", "content-length",
]);

const RESPONSE_BLOCKLIST = new Set([
  "connection", "proxy-connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "set-cookie",
]);

export function buildUpstreamHeaders(headers: IncomingHttpHeaders, credential: CredentialSnapshot, bodyLength?: number): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (REQUEST_BLOCKLIST.has(name.toLowerCase()) || value === undefined) continue;
    result[name] = Array.isArray(value) ? value : String(value);
  }
  result.authorization = `Bearer ${credential.accessToken}`;
  result["chatgpt-account-id"] = credential.accountId;
  if (credential.fedRamp) result["x-openai-fedramp"] = "true";
  if (bodyLength !== undefined) result["content-length"] = String(bodyLength);
  return result;
}

export function buildClientPassthroughHeaders(headers: IncomingHttpHeaders, bodyLength?: number): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (PASSTHROUGH_REQUEST_BLOCKLIST.has(name.toLowerCase()) || value === undefined) continue;
    result[name] = Array.isArray(value) ? value : String(value);
  }
  if (bodyLength !== undefined) result["content-length"] = String(bodyLength);
  return result;
}

export function copyResponseHeaders(
  headers: Record<string, string | string[] | undefined>,
  target: { setHeader(name: string, value: string | string[]): unknown },
): void {
  for (const [name, value] of Object.entries(headers)) {
    if (RESPONSE_BLOCKLIST.has(name.toLowerCase()) || value === undefined) continue;
    target.setHeader(name, value);
  }
}

export function websocketUpgradeHeaders(headers: IncomingHttpHeaders, credential: CredentialSnapshot): Record<string, string | string[]> {
  const result = buildUpstreamHeaders(headers, credential);
  delete result["sec-websocket-key"];
  delete result["sec-websocket-version"];
  delete result["sec-websocket-extensions"];
  delete result["sec-websocket-protocol"];
  return result;
}

export function clientPassthroughWebsocketHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const result = buildClientPassthroughHeaders(headers);
  delete result["sec-websocket-key"];
  delete result["sec-websocket-version"];
  delete result["sec-websocket-extensions"];
  delete result["sec-websocket-protocol"];
  return result;
}

export const IMPORTANT_WS_RESPONSE_HEADERS = new Set([
  "x-codex-turn-state",
  "x-models-etag",
  "x-reasoning-included",
  "openai-model",
]);

const MAX_TURN_METADATA_HEADER_BYTES = 8 * 1024;

export function isCompactionRequest(headers: IncomingHttpHeaders): boolean {
  const value = headers["x-codex-turn-metadata"];
  if (typeof value !== "string" || Buffer.byteLength(value) > MAX_TURN_METADATA_HEADER_BYTES) return false;
  try {
    const metadata = JSON.parse(value) as { request_kind?: unknown };
    return metadata.request_kind === "compaction";
  } catch {
    return false;
  }
}
