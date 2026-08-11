import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AccountUsage } from "./account-usage"

describe("AccountUsage", () => {
  it("renders two labeled Nova progress windows", () => {
    render(
      <AccountUsage
        usage={{
          primary: {
            usedPercent: 28,
            resetsAt: Date.now() + 2 * 60 * 60 * 1000,
            windowDurationMins: 300,
          },
          secondary: {
            usedPercent: 46,
            resetsAt: Date.now() + 3 * 24 * 60 * 60 * 1000,
            windowDurationMins: 10080,
          },
        }}
      />
    )

    expect(
      screen.getByRole("progressbar", { name: /^5 小时额度/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("progressbar", { name: /^7 天额度/ })
    ).toBeInTheDocument()
    expect(screen.getByText("28%")).toBeInTheDocument()
    expect(screen.getByText("46%")).toBeInTheDocument()
    expect(screen.getAllByText(/重置$/)).toHaveLength(2)
  })

  it("shows an indeterminate state when usage is not reported", () => {
    render(<AccountUsage usage={{ primary: null, secondary: null }} />)

    expect(screen.getAllByText("未报告")).toHaveLength(2)
    expect(screen.getAllByText(/暂无额度数据/)).toHaveLength(2)
    expect(screen.queryByText("服务尚未返回额度数据")).not.toBeInTheDocument()
    expect(
      screen.getAllByRole("progressbar", { name: /^用量额度/ })
    ).toHaveLength(2)
  })
})
