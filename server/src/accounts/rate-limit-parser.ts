import type {
  CreditsSnapshot,
  RateLimitBucket,
  RateLimitResetCredit,
  RateLimitResetCreditsSummary,
  RateLimitSnapshot,
  RateLimitWindow,
  SpendControlLimitSnapshot,
} from "../types.js";

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stringAt(value: unknown, ...keys: string[]): string | null {
  const source = object(value);
  for (const key of keys) if (typeof source[key] === "string") return source[key] as string;
  return null;
}

export function numberAt(value: unknown, ...keys: string[]): number | null {
  const source = object(value);
  for (const key of keys) if (typeof source[key] === "number" && Number.isFinite(source[key])) return source[key] as number;
  return null;
}

function booleanAt(value: unknown, ...keys: string[]): boolean | null {
  const source = object(value);
  for (const key of keys) if (typeof source[key] === "boolean") return source[key] as boolean;
  return null;
}

const MILLISECOND_TIMESTAMP_THRESHOLD = 100_000_000_000;

export function normalizeResetTimestamp(value: number | null): number | null {
  if (value === null) return null;
  return value > 0 && value < MILLISECOND_TIMESTAMP_THRESHOLD ? value * 1000 : value;
}

function windowFrom(value: unknown): RateLimitWindow | null {
  const source = object(value);
  if (Object.keys(source).length === 0) return null;
  return {
    usedPercent: numberAt(source, "usedPercent", "used_percent"),
    resetsAt: normalizeResetTimestamp(numberAt(source, "resetsAt", "resets_at")),
    windowDurationMins: numberAt(source, "windowDurationMins", "window_duration_mins"),
  };
}

function creditsFrom(value: unknown): CreditsSnapshot | null {
  const source = object(value);
  if (Object.keys(source).length === 0) return null;
  return {
    hasCredits: booleanAt(source, "hasCredits", "has_credits") ?? false,
    unlimited: booleanAt(source, "unlimited") ?? false,
    balance: stringAt(source, "balance"),
  };
}

function individualLimitFrom(value: unknown): SpendControlLimitSnapshot | null {
  const source = object(value);
  const limit = stringAt(source, "limit");
  const used = stringAt(source, "used");
  const remainingPercent = numberAt(source, "remainingPercent", "remaining_percent");
  const resetsAt = normalizeResetTimestamp(numberAt(source, "resetsAt", "resets_at"));
  if (limit === null || used === null || remainingPercent === null || resetsAt === null) return null;
  return { limit, used, remainingPercent, resetsAt };
}

function bucketFrom(value: unknown, fallbackKey: string): RateLimitBucket {
  const source = object(value);
  const limitId = stringAt(source, "limitId", "limit_id");
  return {
    key: limitId ?? fallbackKey,
    limitId,
    limitName: stringAt(source, "limitName", "limit_name"),
    primary: windowFrom(source.primary),
    secondary: windowFrom(source.secondary),
    credits: creditsFrom(source.credits),
    individualLimit: individualLimitFrom(source.individualLimit ?? source.individual_limit),
    spendControlReached: booleanAt(source, "spendControlReached", "spend_control_reached"),
    planType: stringAt(source, "planType", "plan_type"),
    rateLimitReachedType: stringAt(source, "rateLimitReachedType", "rate_limit_reached_type"),
  };
}

function resetCreditFrom(value: unknown): RateLimitResetCredit | null {
  const source = object(value);
  const id = stringAt(source, "id");
  const resetType = stringAt(source, "resetType", "reset_type");
  const status = stringAt(source, "status");
  const grantedAt = normalizeResetTimestamp(numberAt(source, "grantedAt", "granted_at"));
  if (!id || !resetType || !status || grantedAt === null) return null;
  return {
    id,
    resetType,
    status,
    grantedAt,
    expiresAt: normalizeResetTimestamp(numberAt(source, "expiresAt", "expires_at")),
    title: stringAt(source, "title"),
    description: stringAt(source, "description"),
  };
}

function resetCreditsFrom(value: unknown): RateLimitResetCreditsSummary | null {
  const source = object(value);
  if (Object.keys(source).length === 0) return null;
  const availableCount = numberAt(source, "availableCount", "available_count");
  if (availableCount === null) return null;
  const rawCredits = source.credits;
  const credits = rawCredits === null || rawCredits === undefined
    ? null
    : Array.isArray(rawCredits)
      ? rawCredits.map(resetCreditFrom).filter((item): item is RateLimitResetCredit => item !== null)
      : null;
  return { availableCount: Math.max(0, Math.trunc(availableCount)), credits };
}

export function parseRateLimitResponse(result: unknown): RateLimitSnapshot {
  const root = object(result);
  const rawDefault = root.rateLimits ?? root.rate_limits ?? result;
  const defaultBucket = bucketFrom(rawDefault, "default");
  const byId = object(root.rateLimitsByLimitId ?? root.rate_limits_by_limit_id);
  const bucketMap = new Map<string, RateLimitBucket>();
  bucketMap.set(defaultBucket.key, defaultBucket);
  for (const [key, value] of Object.entries(byId)) {
    const bucket = bucketFrom(value, key);
    bucketMap.set(bucket.key, bucket);
  }
  const buckets = [...bucketMap.values()];
  const selected = buckets.find((bucket) => bucket.key === defaultBucket.key)
    ?? buckets.find((bucket) => bucket.limitId === "codex")
    ?? buckets[0]
    ?? null;
  const outerReached = stringAt(root, "rateLimitReachedType", "rate_limit_reached_type");
  return {
    primary: selected?.primary ?? null,
    secondary: selected?.secondary ?? null,
    rateLimitReachedType: outerReached ?? selected?.rateLimitReachedType ?? null,
    planType: selected?.planType ?? null,
    buckets,
    defaultBucketKey: selected?.key ?? null,
    resetCredits: resetCreditsFrom(root.rateLimitResetCredits ?? root.rate_limit_reset_credits),
    loadedAt: Date.now(),
  };
}
