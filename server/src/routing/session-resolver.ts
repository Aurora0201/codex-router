import { randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { RoutingIdentity } from "../types.js";

function header(headers: IncomingHttpHeaders, names: string[]): string | null {
  for (const name of names) {
    const value = headers[name];
    if (typeof value === "string" && value.length > 0) return value;
    if (Array.isArray(value) && value[0]) return value[0];
  }
  return null;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function inspectBody(rawBody: Buffer | string | null): { threadId: string | null; sessionId: string | null; previousResponseId: string | null } {
  if (!rawBody) return { threadId: null, sessionId: null, previousResponseId: null };
  try {
    const parsed = object(JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody));
    const metadata = object(parsed.client_metadata ?? parsed.clientMetadata ?? parsed.metadata);
    const request = object(parsed.request);
    const nestedMetadata = object(request.client_metadata ?? request.clientMetadata);
    return {
      threadId: string(metadata.thread_id ?? metadata.threadId ?? nestedMetadata.thread_id ?? nestedMetadata.threadId),
      sessionId: string(metadata.session_id ?? metadata.sessionId ?? nestedMetadata.session_id ?? nestedMetadata.sessionId),
      previousResponseId: string(parsed.previous_response_id ?? parsed.previousResponseId ?? request.previous_response_id),
    };
  } catch {
    return { threadId: null, sessionId: null, previousResponseId: null };
  }
}

export function resolveSession(headers: IncomingHttpHeaders, rawBody: Buffer | string | null, temporaryPrefix = "request"): RoutingIdentity {
  const body = inspectBody(rawBody);
  const threadId = header(headers, ["thread-id", "x-thread-id", "x-codex-thread-id", "openai-thread-id"]) ?? body.threadId;
  const sessionId = header(headers, ["session-id", "x-session-id", "x-codex-session-id", "openai-session-id"]) ?? body.sessionId;
  const previousResponseId = body.previousResponseId;
  if (threadId) return { routingKey: `thread:${threadId}`, threadId, sessionId, previousResponseId, temporary: false };
  if (sessionId) return { routingKey: `session:${sessionId}`, threadId, sessionId, previousResponseId, temporary: false };
  if (previousResponseId) return { routingKey: `response:${previousResponseId}`, threadId, sessionId, previousResponseId, temporary: false };
  return {
    routingKey: `${temporaryPrefix}:${randomUUID()}`,
    threadId: null,
    sessionId: null,
    previousResponseId: null,
    temporary: true,
  };
}

export function resolveFirstWebSocketFrame(raw: Buffer | string): RoutingIdentity | null {
  const inspected = inspectBody(raw);
  if (inspected.threadId) return {
    routingKey: `thread:${inspected.threadId}`,
    threadId: inspected.threadId,
    sessionId: inspected.sessionId,
    previousResponseId: inspected.previousResponseId,
    temporary: false,
  };
  if (inspected.sessionId) return {
    routingKey: `session:${inspected.sessionId}`,
    threadId: null,
    sessionId: inspected.sessionId,
    previousResponseId: inspected.previousResponseId,
    temporary: false,
  };
  if (inspected.previousResponseId) return {
    routingKey: `response:${inspected.previousResponseId}`,
    threadId: null,
    sessionId: null,
    previousResponseId: inspected.previousResponseId,
    temporary: false,
  };
  return null;
}
