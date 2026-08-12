export interface TransportErrorCause {
  name?: string;
  code?: string;
}

export interface TransportErrorEvidence {
  diagnosticCode: string;
  transportErrorChain?: TransportErrorCause[];
}

const MAX_CAUSE_DEPTH = 5;
const MAX_IDENTIFIER_LENGTH = 64;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:-]+$/;

function identifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length === 0 || value.length > MAX_IDENTIFIER_LENGTH)
    return undefined;
  return SAFE_IDENTIFIER.test(value) ? value : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function property(
  value: Record<string, unknown>,
  key: "name" | "code" | "cause",
): unknown {
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

export function transportErrorEvidence(error: unknown): TransportErrorEvidence {
  const chain: TransportErrorCause[] = [];
  const seen = new Set<object>();
  let current: unknown = error;

  while (chain.length < MAX_CAUSE_DEPTH) {
    const item = record(current);
    if (!item || seen.has(item)) break;
    seen.add(item);
    const cause = {
      name: identifier(property(item, "name")),
      code: identifier(property(item, "code")),
    };
    if (cause.name || cause.code) chain.push(cause);
    current = property(item, "cause");
  }

  const diagnosticCode =
    [...chain].reverse().find((cause) => cause.code)?.code ??
    "upstream_request_failed";
  return {
    diagnosticCode,
    ...(chain.length ? { transportErrorChain: chain } : {}),
  };
}
