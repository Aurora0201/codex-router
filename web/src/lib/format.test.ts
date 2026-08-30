import { describe, expect, it } from "vitest"
import { formatDateOnly, formatUsageWindow, shortAccountId } from "./format"

describe("account formatting", () => {
  it("formats UTC dates independently of the runner locale", () => {
    expect(formatDateOnly(Date.UTC(2026, 8, 5, 23, 59))).toBe("2026/09/05")
  })

  it("formats backend usage windows as meaningful quota names", () => {
    expect(
      formatUsageWindow({
        usedPercent: 10,
        resetsAt: null,
        windowDurationMins: 300,
      })
    ).toBe("5 小时额度")
    expect(
      formatUsageWindow({
        usedPercent: 10,
        resetsAt: null,
        windowDurationMins: 10080,
      })
    ).toBe("7 天额度")
    expect(
      formatUsageWindow({
        usedPercent: 10,
        resetsAt: null,
        windowDurationMins: 2 * 10080,
      })
    ).toBe("14 天额度")
  })

  it("keeps short ids and truncates long ids consistently", () => {
    expect(shortAccountId("short-id")).toBe("short-id")
    expect(shortAccountId("account-0123456789abcdef")).toBe("account-…cdef")
  })
})
