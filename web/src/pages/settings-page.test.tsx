import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { GatewaySnapshot } from "@/services/contracts"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import { SettingsPage } from "./settings-page"

async function renderPage(mutate?: (snapshot: GatewaySnapshot) => void) {
  const service = createGatewayServiceFixture()
  mutate?.(service.snapshot)
  const onShowAccounts = vi.fn()
  const reload = vi.fn(async () => undefined)
  render(
    <ThemeProvider>
      <Toaster>
        <TooltipProvider>
          <SettingsPage
            snapshot={await service.getSnapshot()}
            service={service}
            reload={reload}
            onShowAccounts={onShowAccounts}
          />
        </TooltipProvider>
      </Toaster>
    </ThemeProvider>
  )
  return { service, onShowAccounts, reload }
}

describe("SettingsPage", () => {
  it("leads with what the takeover forwarded, then how it performed", async () => {
    await renderPage()

    const headline = screen.getByText("已接管 Codex 的全部请求")
    const availability = screen.getByRole("heading", { name: "API 可用性" })
    expect(headline).toBeInTheDocument()
    // Exactly one ink block: the hero. Anything more and it stops being one.
    expect(document.querySelectorAll(".bg-emphasis")).toHaveLength(1)
    expect(headline.closest(".bg-emphasis")).not.toBeNull()
    // The substitution is stated as a pair of figures, not a topology.
    expect(screen.getByText("请求出口")).toBeInTheDocument()
    expect(screen.getByText("请求身份")).toBeInTheDocument()
    expect(screen.getByText("account-1@example.com")).toBeInTheDocument()
    expect(
      headline.compareDocumentPosition(availability) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.queryByText("今日运行")).not.toBeInTheDocument()
  })

  it("counts nothing as forwarded while the config is still untouched", async () => {
    await renderPage((snapshot) => {
      snapshot.codex.applied = false
      snapshot.codex.openaiBaseUrl = "https://chatgpt.com/backend-api/codex"
    })

    expect(screen.getByText("尚未接管 Codex 的请求")).toBeInTheDocument()
    // Requests do not reach us before the rewrite, so the hero reports zero
    // rather than borrowing the gateway's own totals.
    const hero = screen
      .getByText("尚未接管 Codex 的请求")
      .closest(".bg-emphasis")
    expect(hero).not.toBeNull()
    expect(within(hero as HTMLElement).getByText("0")).toBeInTheDocument()
    expect(
      screen.getByText("Codex 仍在直接访问上游，没有请求经过 Router")
    ).toBeInTheDocument()
    expect(
      within(hero as HTMLElement).getByText(
        "https://chatgpt.com/backend-api/codex"
      )
    ).toBeInTheDocument()
  })

  it("shows Codex client passthrough for an empty account pool", async () => {
    await renderPage((snapshot) => {
      snapshot.accounts.accounts = []
      snapshot.accounts.activeAccountId = null
      snapshot.stats.accountsReady = 0
    })
    expect(
      screen.getByText("已接管，按 Codex 默认账号透传")
    ).toBeInTheDocument()
    expect(screen.getByText("Codex 默认账号")).toBeInTheDocument()
  })

  it("shows only the apply action before takeover and keeps confirmation", async () => {
    const user = userEvent.setup()
    const { service, reload } = await renderPage((snapshot) => {
      snapshot.codex.applied = false
    })
    expect(
      screen.getByRole("button", { name: "应用 Codex Router" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "恢复原始配置" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "重启 Codex" })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "应用 Codex Router" }))
    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(service.snapshot.codex.applied).toBe(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it("offers restore after configuration is applied but Codex is stopped", async () => {
    await renderPage((snapshot) => {
      snapshot.codex.codexRunning = false
    })
    expect(screen.getByText("已接管，等待 Codex 启动")).toBeInTheDocument()
    expect(screen.getByText("Codex 当前未运行")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "重启 Codex" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "恢复原始配置" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "应用 Codex Router" })
    ).not.toBeInTheDocument()
  })

  it.each([
    {
      name: "no active account",
      mutate: (snapshot: GatewaySnapshot) => {
        snapshot.accounts.activeAccountId = null
        snapshot.accounts.accounts.forEach((account) => {
          account.isActive = false
        })
      },
    },
    {
      name: "unavailable active account",
      mutate: (snapshot: GatewaySnapshot) => {
        snapshot.accounts.accounts[0].authStatus = "relogin_required"
      },
    },
  ])(
    "routes $name to account management without a page-level alert",
    async ({ mutate }) => {
      const user = userEvent.setup()
      const { onShowAccounts } = await renderPage(mutate)
      expect(
        screen.getByText("已接管出口，但换不到可用身份")
      ).toBeInTheDocument()
      expect(screen.getByText("无可用账号")).toBeInTheDocument()
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      await user.click(screen.getByRole("button", { name: "前往账号路由" }))
      expect(onShowAccounts).toHaveBeenCalledOnce()
    }
  )

  it("shows guidance without unusable actions when the Codex config is missing", async () => {
    await renderPage((snapshot) => {
      snapshot.codex.configExists = false
      snapshot.codex.hasBackup = false
    })
    expect(screen.getByText("找不到 Codex 配置")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", {
        name: /应用 Codex Router|恢复原始配置|重启 Codex/,
      })
    ).not.toBeInTheDocument()
  })

  it("condenses the safety boundary into one line", async () => {
    await renderPage()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByText("网络与安全边界")).not.toBeInTheDocument()
  })

  it("pins the connection list and summarises it beside itself", async () => {
    await renderPage((snapshot) => {
      snapshot.websocketConnections = [
        {
          connectionId: "connection-1",
          state: "idle",
          connectedAt: Date.now() - 90_000,
        },
        {
          connectionId: "connection-2",
          state: "transmitting",
          connectedAt: Date.now() - 30_000,
        },
      ]
    })

    // A live list can be any length, so it scrolls inside a fixed body rather
    // than dragging the summary beside it taller.
    const list = screen.getByLabelText("WebSocket 实时传输")
    expect(list.parentElement).toHaveClass("h-72")
    expect(
      list.querySelector('[data-slot="scroll-area-viewport"]')
    ).not.toBeNull()
    for (const header of within(list).getAllByRole("columnheader")) {
      expect(header).toHaveClass("sticky", "top-0", "bg-muted")
    }

    const summary = screen
      .getByRole("heading", { name: "连接概览" })
      .closest("section") as HTMLElement
    expect(within(summary).getByText("连接总数：")).toBeInTheDocument()
    expect(within(summary).getByText("2")).toBeInTheDocument()
  })

  it("puts every runtime fact in one strip without a scroll of its own", async () => {
    await renderPage()
    const environment = screen
      .getByRole("heading", { name: "运行环境" })
      .closest("section") as HTMLElement
    for (const label of ["监听地址", "配置文件", "数据库", "日志级别"]) {
      expect(within(environment).getByText(label)).toBeInTheDocument()
    }
    expect(environment.querySelector('[data-slot="scroll-area"]')).toBeNull()
  })
})
