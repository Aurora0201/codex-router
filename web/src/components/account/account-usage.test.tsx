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
    expect(screen.getByText("2 小时后回满")).toBeInTheDocument()
  })

  it("labels a full week as 周额度, not 7 天额度", () => {
    render(
      <QuotaMeter
        window={{
          usedPercent: 46,
          resetsAt: Date.now() + 3 * 24 * HOUR,
          windowDurationMins: 10080,
        }}
      />
    )

    expect(
      screen.getByRole("progressbar", { name: "周额度剩余" })
    ).toBeInTheDocument()
    expect(screen.getByText("54%")).toBeInTheDocument()
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
    expect(screen.getByText("3 小时后回满")).toHaveClass("text-foreground")
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
