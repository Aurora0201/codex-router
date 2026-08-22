import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { GatewaySnapshot } from "@/services/contracts"
import type { GatewayService } from "@/services/contracts"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import { AccountsPage } from "./accounts-page"

function renderPage(snapshot: GatewaySnapshot, service: GatewayService) {
  return render(
    <TooltipProvider>
      <AccountsPage snapshot={snapshot} service={service} reload={vi.fn()} />
    </TooltipProvider>
  )
}

describe("AccountsPage", () => {
  it("edits a subscription date with the shadcn date picker dialog", async () => {
    const service = createGatewayServiceFixture()
    service.snapshot.accounts.accounts[0].subscriptionStartedAt = Date.UTC(
      2026,
      7,
      1
    )
    service.snapshot.accounts.accounts[0].subscriptionExpiresAt = Date.UTC(2026, 7, 31)
    service.snapshot.accounts.accounts[0].subscription.expiresAt = Date.UTC(2026, 7, 31)
    service.snapshot.accounts.accounts[0].subscription.source = "manual"
    const updateAccount = vi.spyOn(service, "updateAccount")

    renderPage(await service.getSnapshot(), service)
    await userEvent.click(
      screen.getAllByRole("button", { name: "账号操作" })[0]
    )
    await userEvent.click(await screen.findByText("设置订阅到期日"))

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "到期提醒日期：2026-08-31"
    )
    expect(
      screen.getByRole("button", { name: /2026-08-31/ })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "保存" }))
    expect(updateAccount).toHaveBeenCalledWith("account-1", {
      subscriptionExpiresAt: Date.UTC(2026, 7, 31),
    })
  })

  it("focuses the healthy page on the searchable account pool", async () => {
    const service = createGatewayServiceFixture()
    const snapshot = await service.getSnapshot()

    renderPage(snapshot, service)

    expect(screen.queryByText("实时路由")).not.toBeInTheDocument()
    expect(screen.queryByText("运行概览")).not.toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: "搜索授权账号" })
    ).toBeInTheDocument()
  })

  it("shows the unselected route summary without an alert", async () => {
    const service = createGatewayServiceFixture({ activeAccountId: null })
    const snapshot = await service.getSnapshot()

    renderPage(snapshot, service)

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByText("尚未选择路由账号")).toBeInTheDocument()
  })

  it("clears the manual route from the route summary", async () => {
    const service = createGatewayServiceFixture()
    const clearActiveAccount = vi.spyOn(service, "clearActiveAccount")
    renderPage(await service.getSnapshot(), service)

    await userEvent.click(screen.getByRole("button", { name: "清除路由" }))
    expect(clearActiveAccount).toHaveBeenCalled()
  })

  it("warns when the active route account is unavailable", async () => {
    const service = createGatewayServiceFixture()
    const snapshot = await service.getSnapshot()
    snapshot.accounts.accounts[0].authStatus = "relogin_required"
    snapshot.accounts.accounts[0].auth.status = "relogin_required"

    renderPage(snapshot, service)

    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("当前路由账号不可用")
    expect(alert).toHaveTextContent("需要重新登录")
    expect(alert).toHaveClass("text-destructive")
  })

  it("centers the add-account action against the two-line page heading", async () => {
    const service = createGatewayServiceFixture()
    const snapshot = await service.getSnapshot()
    renderPage(snapshot, service)

    const add = screen.getByRole("button", { name: "添加账号" })
    expect(add.parentElement?.parentElement).toHaveClass("sm:items-center")
    await userEvent.click(add)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("explains Codex client passthrough when the account pool is empty", async () => {
    const service = createGatewayServiceFixture({ activeAccountId: null })
    service.snapshot.accounts.accounts = []
    renderPage(await service.getSnapshot(), service)
    expect(
      screen.getByText(/账号池为空时，请求会使用 Codex 当前登录账号透传/)
    ).toBeInTheDocument()
  })

  it("uses one shared dialog from both empty-state triggers and keeps it mounted after completion", async () => {
    const service = createGatewayServiceFixture({ activeAccountId: null })
    const open = vi.spyOn(window, "open").mockReturnValue(null)
    const addedAccount = structuredClone(service.snapshot.accounts.accounts[0])
    service.snapshot.accounts.accounts = []
    service.getLoginStatus = vi.fn(async () => {
      service.snapshot.accounts.accounts = [addedAccount]
      return {
        loginId: "login-1",
        status: "complete" as const,
        authUrl: "https://auth.openai.test/codex",
      }
    })
    const initial = await service.getSnapshot()

    function Harness() {
      const [snapshot, setSnapshot] = useState(initial)
      return (
        <AccountsPage
          snapshot={snapshot}
          service={service}
          reload={async () => setSnapshot(await service.getSnapshot())}
        />
      )
    }

    render(
      <TooltipProvider>
        <Harness />
      </TooltipProvider>
    )
    const triggers = screen.getAllByRole("button", { name: "添加账号" })
    expect(triggers).toHaveLength(2)
    await userEvent.click(triggers[1])
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    await userEvent.click(screen.getByRole("button", { name: "启动登录" }))

    expect(
      await screen.findByText("授权完成", {}, { timeout: 2_000 })
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(
        document.querySelector('[aria-label="搜索授权账号"]')
      ).toBeInTheDocument()
    )
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    open.mockRestore()
  })
})
