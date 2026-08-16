import type { RateLimitSnapshot, RateLimitWindow } from "../types.js";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringAt(value: unknown, ...keys: string[]): string | null {
  const source = object(value);
  for (const key of keys) if (typeof source[key] === "string") return source[key] as string;
  return null;
}

function numberAt(value: unknown, ...keys: string[]): number | null {
  const source = object(value);
  for (const key of keys) if (typeof source[key] === "number") return source[key] as number;
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

export function parseRateLimitResponse(result: unknown): RateLimitSnapshot {
  const root = object(result);
  const limits = object(root.rateLimits ?? root.rate_limits ?? result);
  return {
    primary: windowFrom(limits.primary),
    secondary: windowFrom(limits.secondary),
    rateLimitReachedType: stringAt(root, "rateLimitReachedType", "rate_limit_reached_type") ?? stringAt(limits, "rateLimitReachedType", "rate_limit_reached_type"),
    planType: stringAt(limits, "planType", "plan_type"),
    loadedAt: Date.now(),
  };
}

export { object, stringAt, numberAt };
