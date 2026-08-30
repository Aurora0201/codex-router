import type {
  AccountView,
  RateLimitBucketView,
  UsageWindowView,
} from "@/services/contracts"

export const QUOTA_STALE_MS = 10 * 60_000
/** Remaining quota at or below this share turns the meter into a warning. */
export const QUOTA_TIGHT_PERCENT = 25
const DAY_MINS = 1440
/**
 * Codex reports a 5-hour and a 7-day window per bucket. These name a slot the
 * upstream omitted, so an absent window can still say which cap it stands for.
 */
export const SLOT_WINDOW_MINS = [7 * DAY_MINS, 300] as const

export function isDisabled(account: AccountView) {
  return !account.enabled || account.auth.status === "disabled"
}

export function isRoutable(account: AccountView) {
  return account.enabled && account.auth.status === "ready"
}

export function needsAttention(account: AccountView) {
  if (isDisabled(account)) return false
  return !isRoutable(account)
}

export function defaultBucket(
  account: AccountView
): RateLimitBucketView | undefined {
  return (
    account.limits.buckets.find(
      (bucket) => bucket.key === account.limits.defaultBucketKey
    ) ?? account.limits.buckets[0]
  )
}

/** The bucket's windows, longest first, so the weekly ceiling reads above the short window. */
export function accountWindows(account: AccountView): UsageWindowView[] {
  const bucket = defaultBucket(account)
  if (!bucket) return []
  return [bucket.primary, bucket.secondary]
    .filter((window): window is UsageWindowView => window !== null)
    .sort((a, b) => (b.windowDurationMins ?? 0) - (a.windowDurationMins ?? 0))
    .slice(0, 2)
}

/**
 * Exactly two slots, longest window first, padded with nulls. The row is a
 * two-line layout, so a missing window holds its place rather than collapsing
 * the account to a single line.
 */
export function accountWindowSlots(
  account: AccountView
): [UsageWindowView | null, UsageWindowView | null] {
  const windows = accountWindows(account)
  // Split by role rather than by position, so a lone weekly window leaves the
  // short slot empty and not the other way round.
  const long =
    windows.find((w) => (w.windowDurationMins ?? 0) >= DAY_MINS) ?? null
  const short =
    windows.find(
      (w) => w.windowDurationMins !== null && w.windowDurationMins < DAY_MINS
    ) ?? null
  if (long || short) return [long, short]
  return [windows[0] ?? null, windows[1] ?? null]
}

export function remainingPercent(window: UsageWindowView): number | null {
  if (window.usedPercent === null) return null
  return Math.min(100, Math.max(0, 100 - window.usedPercent))
}

/** The tightest reported window, which is what actually caps the next request. */
export function tightestRemaining(account: AccountView): number | null {
  const values = accountWindows(account)
    .map(remainingPercent)
    .filter((value): value is number => value !== null)
  return values.length ? Math.min(...values) : null
}
