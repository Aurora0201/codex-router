import { describe, expect, it } from "vitest"
import {
  formatDateOnly,
  formatUsageWindow,
  isMachineText,
  shortAccountId,
} from "./format"

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

describe("isMachineText", () => {
  it("accepts values a monospace face can render whole", () => {
    for (const value of [
      "121",
      "99.4%",
      "3 / 3",
      "2026/9/1 19:12:48",
      "ready",
      String.raw`C:\\Users\\me\\.codex\\config.toml`,
      "http://127.0.0.1:8317/backend-api/codex",
      "me@example.com",
      "—",
    ])
      expect(isMachineText(value)).toBe(true)
  })

  it("rejects anything that would fall back mid-string", () => {
    // Roboto Mono has no CJK: these render part Roboto, part Noto Sans SC.
    for (const value of [
      "2.9亿",
      "1309.7万",
      "正在运行",
      "0 小时 2 分钟",
      "完整",
    ])
      expect(isMachineText(value)).toBe(false)
  })
})
