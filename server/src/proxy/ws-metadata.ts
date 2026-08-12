import { JSONParser } from "@streamparser/json";
import type { IncomingHttpHeaders } from "node:http";
import type { RawData } from "ws";

const MAX_TURN_METADATA_BYTES = 8 * 1024;
const MAX_SAFE_ID_BYTES = 256;
const SAFE_ID = /^[A-Za-z0-9._:-]+$/;

const CLIENT_PATHS = [
  "$.type",
  "$.generate",
  "$.client_metadata.x-codex-turn-metadata",
  "$.client_metadata.session_id",
  "$.client_metadata.thread_id",
  "$.client_metadata.turn_id",
];

const SERVER_PATHS = [
  "$.type",
  "$.response.error.code",
  "$.response.incomplete_details.reason",
  "$.status",
  "$.status_code",
  "$.error.code",
];

export interface ClientFrameMetadata {
  type?: string;
  generate?: boolean;
  requestKind?: string;
  sessionId?: string;
  threadId?: string;
  turnId?: string;
}
export type TurnIdentifiers = Pick<ClientFrameMetadata, "sessionId" | "threadId" | "turnId">;
export interface ServerFrameMetadata {
  type?: string;
  errorCode?: string;
  incompleteReason?: string;
  status?: number;
  parseFailed?: boolean;
}

export function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function selectedValues(
  data: RawData,
  paths: string[],
): Map<string, unknown> | null {
  const values = new Map<string, unknown>();
  let failed = false;
  try {
    const parser = new JSONParser({
      paths,
      keepStack: false,
      stringBufferSize: 64 * 1024,
    });
    parser.onValue = ({ key, value }) => {
      if (typeof key === "string") values.set(key, value);
    };
    parser.onError = () => {
      failed = true;
    };
    parser.write(rawDataBuffer(data));
    if (!parser.isEnded) parser.end();
  } catch {
    return null;
  }
  return failed ? null : values;
}

function safeId(value: unknown): string | undefined {
  return typeof value === "string" && Buffer.byteLength(value) <= MAX_SAFE_ID_BYTES && SAFE_ID.test(value)
    ? value
    : undefined;
}

export function inspectTurnMetadata(value: unknown): Pick<ClientFrameMetadata, "requestKind" | "sessionId" | "threadId" | "turnId"> {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value) > MAX_TURN_METADATA_BYTES
  )
    return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return {
      requestKind: typeof parsed.request_kind === "string" ? parsed.request_kind : undefined,
      sessionId: safeId(parsed.session_id),
      threadId: safeId(parsed.thread_id),
      turnId: safeId(parsed.turn_id),
    };
  } catch {
    return {};
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function inspectHandshakeTurnMetadata(headers: IncomingHttpHeaders): TurnIdentifiers {
  const nested = inspectTurnMetadata(firstHeader(headers["x-codex-turn-metadata"]));
  return {
    threadId: nested.threadId ?? safeId(firstHeader(headers["thread-id"])),
    ...(nested.sessionId ? { sessionId: nested.sessionId } : {}),
    ...(nested.turnId ? { turnId: nested.turnId } : {}),
  };
}

export function inspectClientFrame(
  data: RawData,
  isBinary: boolean,
): ClientFrameMetadata | null {
  if (isBinary) return null;
  const values = selectedValues(data, CLIENT_PATHS);
  if (!values) return null;
  const direct: TurnIdentifiers = {
    sessionId: safeId(values.get("session_id")),
    threadId: safeId(values.get("thread_id")),
    turnId: safeId(values.get("turn_id")),
  };
  const metadata = inspectTurnMetadata(values.get("x-codex-turn-metadata"));
  return {
    type:
      typeof values.get("type") === "string"
        ? (values.get("type") as string)
        : undefined,
    generate:
      typeof values.get("generate") === "boolean"
        ? (values.get("generate") as boolean)
        : undefined,
    ...direct,
    ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)),
  };
}
export function inspectServerFrame(
  data: RawData,
  isBinary: boolean,
): ServerFrameMetadata | null {
  if (isBinary) return null;
  const values = selectedValues(data, SERVER_PATHS);
  if (!values) return { parseFailed: true };
  return {
    type:
      typeof values.get("type") === "string"
        ? (values.get("type") as string)
        : undefined,
    errorCode:
      typeof values.get("code") === "string"
        ? (values.get("code") as string)
        : undefined,
    incompleteReason:
      typeof values.get("reason") === "string"
        ? (values.get("reason") as string)
        : undefined,
    status:
      typeof values.get("status") === "number"
        ? (values.get("status") as number)
        : typeof values.get("status_code") === "number"
          ? (values.get("status_code") as number)
          : undefined,
  };
}

// Metadata inspection never changes the frame forwarded to either peer.
