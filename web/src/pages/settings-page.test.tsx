import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import type { GatewaySnapshot } from "@/services/contracts"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import { SettingsPage } from "./settings-page"

async function renderPage(
  scenario: "healthy" | "degraded" = "healthy",
  stats: Partial<GatewaySnapshot["stats"]> = {}
) {
  const service = createGatewayServiceFixture({
    degraded: scenario === "degraded",
    stats,
  })
  const serviceSnapshot = await service.getSnapshot()
  const snapshot = serviceSnapshot
  const onShowAccounts = vi.fn()
  const reload = vi.fn()

  render(
    <ThemeProvider>
      <Toaster>
        <SettingsPage
          snapshot={snapshot}
          service={service}
          reload={reload}
          onShowAccounts={onShowAccounts}
          onShowLogs={vi.fn()}
        />
      </Toaster>
    </ThemeProvider>
  )

  return { onShowAccounts, reload, service }
}

describe("SettingsPage", () => {
  it("prioritizes takeover status, runtime summary, and the network boundary", async () => {
    const user = userEvent.setup()
    const { onShowAccounts } = await renderPage()

    expect(screen.getByText("接管正常").closest("span")).toHaveClass(
      "text-success"
    )
    expect(screen.getByText("Codex 已通过 Codex Router 接管")).toBeInTheDocument()
    expect(screen.getByText("Codex 正在运行").closest("span")).toHaveClass(
      "text-success"
    )
    const requestMetric = screen.getByLabelText("今日请求指标")
    const errorMetric = screen.getByLabelText("请求错误指标")
    expect(within(requestMetric).getByText("1,284")).toHaveClass("tabular-nums")
    expect(within(requestMetric).getByText("1,284")).not.toHaveClass(
      "font-mono"
    )
    expect(within(errorMetric).getByText("3")).toHaveClass("tabular-nums")
    expect(within(errorMetric).getByText("0.23%")).toHaveClass("tabular-nums")
    expect(screen.getByText("21")).toHaveClass("tabular-nums")
    expect(screen.getByText("小时")).toHaveClass("text-muted-foreground")
    expect(screen.getByText("网络与安全边界")).toBeInTheDocument()
    expect(screen.queryByText("隐私与偏好")).not.toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: "查看 3 个可路由账号" })
    )
    expect(onShowAccounts).toHaveBeenCalledOnce()
  })

  it("elevates takeover and request failures in a degraded scenario", async () => {
    await renderPage("degraded")

    expect(screen.getByText("Codex 尚未接入 Codex Router")).toBeInTheDocument()
    expect(screen.getByText("Codex 尚未接管")).toBeInTheDocument()
    const errorMetric = screen.getByLabelText("请求错误指标")
    expect(within(errorMetric).getByText("19")).toHaveClass("text-destructive")
    expect(screen.getByText("1.48%").parentElement).toHaveClass(
      "text-destructive"
    )
  })

  it("handles an empty request window without dividing by zero", async () => {
    await renderPage("healthy", { requestsToday: 0, errorsToday: 0 })

    expect(
      within(screen.getByLabelText("今日请求指标")).getByText("0")
    ).toBeInTheDocument()
    expect(
      within(screen.getByLabelText("请求错误指标")).getByText("0")
    ).toBeInTheDocument()
    expect(screen.getByText("0.00%")).toBeInTheDocument()
  })

})
