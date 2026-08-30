import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { QuotaMeter } from "./account-usage"

const HOUR = 60 * 60 * 1000

describe("QuotaMeter", () => {
  it("fills by remaining quota so a fuller bar means a better route", () => {
    render(
      <QuotaMeter
        window={{
          usedPercent: 28,
          resetsAt: Date.now() + 2 * HOUR,
          windowDurationMins: 300,
        }}
      />
    )

    const meter = screen.getByRole("progressbar", { name: "5 小时额度剩余" })
    expect(meter).toHaveAttribute("aria-valuenow", "72")
    expect(screen.getByText("72%")).toBeInTheDocument()
    expect(screen.getByText("2 小时后重置")).toBeInTheDocument()
  })

  it("labels a full week as 7 天额度 and counts down in two units", () => {
    render(
      <QuotaMeter
        window={{
          usedPercent: 46,
          resetsAt: Date.now() + 3 * 24 * HOUR + 5 * HOUR,
          windowDurationMins: 10080,
        }}
      />
    )

    expect(
      screen.getByRole("progressbar", { name: "7 天额度剩余" })
    ).toBeInTheDocument()
    expect(screen.getByText("54%")).toBeInTheDocument()
    expect(screen.getByText("3 天 5 小时后重置")).toBeInTheDocument()
  })

  it("keeps an exhausted window measurable and emphasises when it refills", () => {
    render(
      <QuotaMeter
        window={{
          usedPercent: 100,
          resetsAt: Date.now() + 3 * HOUR,
          windowDurationMins: 300,
        }}
      />
    )

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0"
    )
    expect(screen.getByText("0%")).toHaveClass("text-destructive")
    expect(screen.getByText("3 小时后重置")).toHaveClass("text-foreground")
  })

  it.each([
    {
      remaining: 25,
      tone: "warning",
      indicator: "[&_[data-slot=progress-indicator]]:bg-warning",
    },
    {
      remaining: 10,
      tone: "destructive",
      indicator: "[&_[data-slot=progress-indicator]]:bg-destructive",
    },
  ])(
    "uses the $tone semantic color at $remaining% remaining",
    ({ remaining, tone, indicator }) => {
      const { container } = render(
        <QuotaMeter
          window={{
            usedPercent: 100 - remaining,
            resetsAt: Date.now() + HOUR,
            windowDurationMins: 300,
          }}
        />
      )

      expect(screen.getByText(`${remaining}%`)).toHaveClass(`text-${tone}`)
      expect(container.querySelector("[data-slot=quota-meter]")).toHaveClass(
        indicator
      )
    }
  )

  it("names an absent window and draws it full when there is no cap", () => {
    const { container } = render(
      <QuotaMeter window={null} placeholderMins={300} />
    )
    expect(screen.getByText("5 小时额度")).toBeInTheDocument()
    expect(screen.getByText("无限制")).toBeInTheDocument()
    expect(container.querySelector("[data-slot=quota-bar]")).toHaveClass(
      "bg-primary"
    )
  })

  it("holds an empty slot open when the window is missing entirely", () => {
    const { container } = render(
      <QuotaMeter window={null} known={false} fallback="额度尚未刷新" />
    )

    expect(screen.getByText("额度尚未刷新")).toBeInTheDocument()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    // Never claims there is no cap when nothing was ever fetched.
    expect(screen.queryByText("无限制")).not.toBeInTheDocument()
    expect(container.querySelector("[data-slot=quota-bar]")).toHaveClass(
      "bg-foreground/15"
    )
  })

  it("puts the name and the number on one line, the bar beneath, then the reset", () => {
    const { container } = render(
      <QuotaMeter
        window={{
          usedPercent: 20,
          resetsAt: Date.now() + HOUR,
          windowDurationMins: 300,
        }}
      />
    )

    const meter = container.querySelector("[data-slot=quota-meter]")!
    const head = screen.getByText("5 小时额度").parentElement!
    expect(head).toContainElement(screen.getByText("80%"))
    const track = meter.querySelector("[data-slot=progress-track]")!
    expect(head.compareDocumentPosition(track)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    // The countdown is ordered past the track Progress appends after it.
    expect(screen.getByText("1 小时后重置")).toHaveClass("order-3")
  })

  it("renders an unreported window as 未报告 instead of a zeroed bar", () => {
    render(
      <QuotaMeter
        window={{ usedPercent: null, resetsAt: null, windowDurationMins: 300 }}
      />
    )

    expect(screen.getByText("未报告")).toBeInTheDocument()
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
    expect(screen.queryByText("0%")).not.toBeInTheDocument()
  })
})
