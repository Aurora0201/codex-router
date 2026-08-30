import type { BillingCadence } from "@/services/contracts"

const DAY_MS = 24 * 60 * 60_000

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

function utcDate(year: number, month: number, anchorDay: number): number {
  return Date.UTC(year, month, Math.min(anchorDay, daysInUtcMonth(year, month)))
}

export function utcDay(timestamp: number): number {
  const date = new Date(timestamp)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

/** Returns the current or next billing date. The billing day itself remains current. */
export function nextBillingAt(
  anchorAt: number | null,
  cadence: BillingCadence | null,
  now = Date.now()
): number | null {
  if (anchorAt === null || cadence === null) return null
  const anchor = new Date(anchorAt)
  const today = new Date(utcDay(now))
  const anchorDay = anchor.getUTCDate()

  if (cadence === "annual") {
    let year = today.getUTCFullYear()
    let candidate = utcDate(year, anchor.getUTCMonth(), anchorDay)
    if (candidate < today.getTime()) {
      year += 1
      candidate = utcDate(year, anchor.getUTCMonth(), anchorDay)
    }
    return candidate
  }

  let year = today.getUTCFullYear()
  let month = today.getUTCMonth()
  let candidate = utcDate(year, month, anchorDay)
  if (candidate < today.getTime()) {
    month += 1
    if (month === 12) {
      month = 0
      year += 1
    }
    candidate = utcDate(year, month, anchorDay)
  }
  return candidate
}

export function billingDaysRemaining(nextAt: number, now = Date.now()): number {
  return Math.max(0, Math.round((nextAt - utcDay(now)) / DAY_MS))
}
