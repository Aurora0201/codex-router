import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import type { GatewaySnapshot } from "@/services/contracts"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import { SettingsPage } from "./settings-page"

async function renderPage(mutate?: (snapshot: GatewaySnapshot) => void) {
  const service = createGatewayServiceFixture()
  mutate?.(service.snapshot)
  const onShowAccounts = vi.fn()
  const onShowLogs = vi.fn()
  const reload = vi.fn(async () => undefined)
  render(
    <ThemeProvider><Toaster><SettingsPage snapshot={await service.getSnapshot()} service={service} reload={reload} onShowAccounts={onShowAccounts} onShowLogs={onShowLogs} /></Toaster></ThemeProvider>
  )
  return { service, onShowAccounts, onShowLogs, reload }
}

describe("SettingsPage", () => {
  it("prioritizes the managed routing path and presents four metrics in one grid", async () => {
    const user = userEvent.setup()
    const { onShowAccounts, onShowLogs } = await renderPage()

    expect(screen.getByText("Codex Router 接管正常")).toBeInTheDocument()
    expect(screen.getByText("接管正常").closest('[data-slot="badge"]')).toHaveClass("text-success")
    const route = screen.getByRole("list", { name: "当前路由链路" })
    expect(route.querySelectorAll('[data-slot="item"]')).toHaveLength(3)
    expect(within(route).getByText("account-1@example.com")).toBeInTheDocument()

    const metrics = screen.getByText("今日运行").closest('[data-slot="card"]')?.querySelector('[data-slot="item-group"]')
    expect(metrics).toHaveClass("grid-cols-2", "xl:grid-cols-4")
    expect(metrics?.querySelectorAll('[data-slot="item"]')).toHaveLength(4)
    await user.click(screen.getByLabelText("请求错误指标"))
    await user.click(screen.getByRole("button", { name: "查看 3 个可路由账号" }))
    expect(onShowLogs).toHaveBeenCalledOnce()
    expect(onShowAccounts).toHaveBeenCalledOnce()
  })

  it("shows Codex client passthrough for an empty account pool", async () => {
    await renderPage((snapshot) => {
      snapshot.accounts.accounts = []
      snapshot.accounts.activeAccountId = null
      snapshot.stats.accountsReady = 0
    })
    expect(screen.getByText("Codex 默认账号透传")).toBeInTheDocument()
    expect(screen.getByText("透传正常").closest('[data-slot="badge"]')).toHaveClass("text-success")
    expect(screen.getByText("Codex 默认账号")).toBeInTheDocument()
  })

  it("shows only the apply action before takeover and keeps confirmation", async () => {
    const user = userEvent.setup()
    const { service, reload } = await renderPage((snapshot) => {
      snapshot.codex.applied = false
      snapshot.codex.openaiBaseUrl = "https://chatgpt.com/backend-api/codex"
    })
    expect(screen.getByText("Codex 尚未接入 Router")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "应用 Codex Router" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "恢复配置" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "重启 Codex" })).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "应用 Codex Router" }))
    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(service.snapshot.codex.applied).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it("offers restore after configuration is applied but Codex is stopped", async () => {
    await renderPage((snapshot) => { snapshot.codex.codexRunning = false })
    expect(screen.getByText("配置已应用，Codex 当前未运行")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "重启 Codex" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "恢复配置" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "应用 Codex Router" })).not.toBeInTheDocument()
  })

  it.each([
    { name: "no active account", mutate: (snapshot: GatewaySnapshot) => { snapshot.accounts.activeAccountId = null; snapshot.accounts.accounts.forEach((account) => { account.isActive = false }) } },
    { name: "unavailable active account", mutate: (snapshot: GatewaySnapshot) => { snapshot.accounts.accounts[0].authStatus = "relogin_required" } },
  ])("routes $name to account management without a page-level alert", async ({ mutate }) => {
    const user = userEvent.setup()
    const { onShowAccounts } = await renderPage(mutate)
    expect(screen.getByText("等待可用的路由账号")).toBeInTheDocument()
    expect(screen.getByText("路由阻断").closest('[data-slot="badge"]')).toHaveClass("text-destructive")
    expect(screen.queryByRole("alert")).toHaveTextContent("不记录 Prompt")
    await user.click(screen.getByRole("button", { name: "前往账号路由" }))
    expect(onShowAccounts).toHaveBeenCalledOnce()
  })

  it("shows guidance without unusable actions when the Codex config is missing", async () => {
    await renderPage((snapshot) => { snapshot.codex.configExists = false; snapshot.codex.hasBackup = false })
    expect(screen.getByText("找不到 Codex 配置")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /应用 Codex Router|恢复配置|重启 Codex/ })).not.toBeInTheDocument()
  })

  it("condenses the safety boundary into one line", async () => {
    await renderPage()
    expect(screen.getByRole("alert")).toHaveTextContent("只读取路由元数据，不记录 Prompt、工具参数、工具输出或响应正文")
    expect(screen.queryByText("网络与安全边界")).not.toBeInTheDocument()
  })

  it("handles an empty request window without dividing by zero", async () => {
    await renderPage((snapshot) => { snapshot.stats.requestsToday = 0; snapshot.stats.errorsToday = 0 })
    expect(within(screen.getByLabelText("今日请求指标")).getByText("0")).toBeInTheDocument()
    expect(within(screen.getByLabelText("请求错误指标")).getByText("0.00%")).toBeInTheDocument()
  })
})
