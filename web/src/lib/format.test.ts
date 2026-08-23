import { describe, expect, it } from "vitest"
import { formatUsageWindow, shortAccountId } from "./format"

describe("account formatting", () => {
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
