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
  const reload = vi.fn(async () => undefined)
  render(
    <ThemeProvider><Toaster><SettingsPage snapshot={await service.getSnapshot()} service={service} reload={reload} onShowAccounts={onShowAccounts} /></Toaster></ThemeProvider>
  )
  return { service, onShowAccounts, reload }
}

describe("SettingsPage", () => {
  it("prioritizes routing and API availability without duplicating daily metrics", async () => {
    await renderPage()

    const takeoverHeading = screen.getByText("Codex Router 接管正常")
    const availabilityHeading = screen.getByRole("heading", { name: "API 可用性" })
    expect(takeoverHeading).toBeInTheDocument()
    expect(screen.getByText("接管正常").closest('[data-slot="badge"]')).toHaveClass("text-success")
    const route = screen.getByRole("list", { name: "当前路由链路" })
    expect(route.querySelectorAll('[data-slot="item"]')).toHaveLength(3)
    expect(within(route).getByText("account-1@example.com")).toBeInTheDocument()
    expect(screen.queryByText("今日运行")).not.toBeInTheDocument()
    expect(takeoverHeading.compareDocumentPosition(availabilityHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
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
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByText("网络与安全边界")).not.toBeInTheDocument()
  })

  it("constrains the WebSocket card to the remaining desktop height", async () => {
    await renderPage((snapshot) => {
      snapshot.websocketConnections = [{ connectionId: "connection-1", state: "idle", connectedAt: Date.now() }]
    })
    expect(screen.getByLabelText("WebSocket 实时传输")).toHaveClass("lg:flex-1", "lg:basis-0", "lg:min-h-0")
    const card = screen.getByLabelText("WebSocket 实时传输")
    expect(card).toHaveClass("gap-0", "py-0")
    const content = card.querySelector('[data-slot="card-content"]')
    expect(content).toHaveClass("min-h-0", "flex-1", "overflow-hidden")
    expect(card.querySelector('[data-slot="scroll-area"]')).toHaveClass("h-full", "overscroll-contain")
    expect(card.querySelector('[data-slot="scroll-area"]')?.className).toContain("[&_[data-slot=table-container]]:overflow-visible")
    expect(card.querySelector('[data-slot="scroll-area-viewport"]')).toBeInTheDocument()
    for (const header of within(card).getAllByRole("columnheader")) expect(header).toHaveClass("sticky", "top-0", "bg-card")
  })
})
