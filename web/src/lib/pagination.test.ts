import { describe, expect, it } from "vitest"

import { paginationTokens } from "./pagination"

describe("paginationTokens", () => {
  it("lists every page while they still fit", () => {
    expect(paginationTokens(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(paginationTokens(4, 3)).toEqual([1, 2, 3])
    expect(paginationTokens(1, 0)).toEqual([])
  })

  it("keeps the first and last page reachable from anywhere", () => {
    for (const page of [1, 5, 12, 20]) {
      const tokens = paginationTokens(page, 20)
      expect(tokens.at(0)).toBe(1)
      expect(tokens.at(-1)).toBe(20)
    }
  })

  it("elides on the side that has been left behind", () => {
    expect(paginationTokens(2, 20)).toEqual([1, 2, 3, 4, 5, "end-ellipsis", 20])
    expect(paginationTokens(19, 20)).toEqual([
      1,
      "start-ellipsis",
      16,
      17,
      18,
      19,
      20,
    ])
    expect(paginationTokens(10, 20)).toEqual([
      1,
      "start-ellipsis",
      9,
      10,
      11,
      "end-ellipsis",
      20,
    ])
  })

  it("never repeats a page number", () => {
    for (let total = 1; total <= 30; total += 1) {
      for (let page = 1; page <= total; page += 1) {
        const numbers = paginationTokens(page, total).filter(
          (token) => typeof token === "number"
        )
        expect(new Set(numbers).size).toBe(numbers.length)
      }
    }
  })
})
