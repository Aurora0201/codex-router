import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useSlowLoad } from "./use-slow-load"

describe("useSlowLoad", () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it("says nothing about a load that finishes quickly", () => {
    const { result, rerender } = renderHook(
      ({ pending }) => useSlowLoad(pending),
      { initialProps: { pending: true } }
    )

    act(() => void vi.advanceTimersByTime(400))
    rerender({ pending: false })
    act(() => void vi.advanceTimersByTime(2000))

    expect(result.current).toBe(false)
  })

  it("speaks up once a load outlasts the grace period", () => {
    const { result } = renderHook(({ pending }) => useSlowLoad(pending), {
      initialProps: { pending: true },
    })

    act(() => void vi.advanceTimersByTime(499))
    expect(result.current).toBe(false)

    act(() => void vi.advanceTimersByTime(1))
    expect(result.current).toBe(true)
  })

  it("stays up long enough to be read once it is up", () => {
    const { result, rerender } = renderHook(
      ({ pending }) => useSlowLoad(pending),
      { initialProps: { pending: true } }
    )

    act(() => void vi.advanceTimersByTime(500))
    expect(result.current).toBe(true)

    // The load lands a frame later; the treatment holds rather than blinking.
    rerender({ pending: false })
    act(() => void vi.advanceTimersByTime(399))
    expect(result.current).toBe(true)

    act(() => void vi.advanceTimersByTime(1))
    expect(result.current).toBe(false)
  })
})
