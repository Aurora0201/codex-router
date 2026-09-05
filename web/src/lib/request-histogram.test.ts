import { describe, expect, it } from "vitest"

import type { RequestLogRange } from "@/services/contracts"
import { normalizeRequestHistogram } from "./request-histogram"

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

describe("normalizeRequestHistogram", () => {
  it.each<[RequestLogRange, number, number]>([
    ["1h", HOUR, 60],
    ["24h", DAY, 96],
    ["7d", 7 * DAY, 84],
  ])("keeps %s on a fixed bucket count", (range, span, expected) => {
    expect(
      normalizeRequestHistogram(range, 1_000, 1_000 + span, [])
    ).toHaveLength(expected)
  })

  it("fills missing buckets without replacing returned evidence", () => {
    const from = 1_000
    const retained = {
      startedAt: from + 60_000,
      endedAt: from + 120_000,
      requests: 3,
      errors: 1,
      rejected: 0,
      cancelled: 0,
    }

    const result = normalizeRequestHistogram("1h", from, from + HOUR, [
      retained,
    ])

    expect(result).toHaveLength(60)
    expect(result[0]).toMatchObject({ startedAt: from, requests: 0 })
    expect(result[1]).toBe(retained)
  })
})
