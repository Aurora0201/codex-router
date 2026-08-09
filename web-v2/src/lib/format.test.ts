import { describe, expect, it } from "vitest"

import { formatUsageWindowName, shortAccountId } from "@/lib/format"

describe("account display formatting", () => {
  it("uses a compact account id while preserving both ends", () => {
    expect(shortAccountId("acct_01JQ7V5M0F6K9")).toBe("acct_01J…F6K9")
  })

  it.each([
    [30, "30 分钟额度"],
    [300, "5 小时额度"],
    [10_080, "7 天额度"],
  ])("formats %i minutes as a meaningful usage label", (minutes, expected) => {
    expect(formatUsageWindowName(minutes)).toBe(expected)
  })

  it("uses the supplied semantic fallback when upstream omits a window", () => {
    expect(formatUsageWindowName(null, "短周期额度")).toBe("短周期额度")
  })
})
