import { describe, expect, it } from "vitest"

import { billingDaysRemaining, nextBillingAt } from "./billing-cycle"

describe("nextBillingAt", () => {
  it("advances monthly anchors to the current or next billing day", () => {
    const anchor = Date.UTC(2026, 7, 24)
    expect(nextBillingAt(anchor, "monthly", Date.UTC(2026, 8, 10))).toBe(Date.UTC(2026, 8, 24))
    expect(nextBillingAt(anchor, "monthly", Date.UTC(2026, 8, 24, 18))).toBe(Date.UTC(2026, 8, 24))
    expect(nextBillingAt(anchor, "monthly", Date.UTC(2026, 8, 25))).toBe(Date.UTC(2026, 9, 24))
  })

  it("preserves a month-end anchor without drift", () => {
    const anchor = Date.UTC(2025, 0, 31)
    expect(nextBillingAt(anchor, "monthly", Date.UTC(2025, 1, 1))).toBe(Date.UTC(2025, 1, 28))
    expect(nextBillingAt(anchor, "monthly", Date.UTC(2025, 2, 1))).toBe(Date.UTC(2025, 2, 31))
    expect(nextBillingAt(anchor, "monthly", Date.UTC(2028, 1, 1))).toBe(Date.UTC(2028, 1, 29))
  })

  it("preserves a leap-day annual anchor", () => {
    const anchor = Date.UTC(2024, 1, 29)
    expect(nextBillingAt(anchor, "annual", Date.UTC(2025, 0, 1))).toBe(Date.UTC(2025, 1, 28))
    expect(nextBillingAt(anchor, "annual", Date.UTC(2028, 0, 1))).toBe(Date.UTC(2028, 1, 29))
  })

  it("reports the billing day as today", () => {
    const next = Date.UTC(2026, 8, 24)
    expect(billingDaysRemaining(next, Date.UTC(2026, 8, 24, 23, 59))).toBe(0)
  })
})
