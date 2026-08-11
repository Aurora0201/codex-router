import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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

  it("warns when no route account is selected", async () => {
    const service = createGatewayServiceFixture({ activeAccountId: null })
    const snapshot = await service.getSnapshot()

    renderPage(snapshot, service)

    expect(screen.getByRole("alert")).toHaveTextContent("尚未选择路由账号")
  })

  it("warns when the active route account is unavailable", async () => {
    const service = createGatewayServiceFixture()
    const snapshot = await service.getSnapshot()
    snapshot.accounts.accounts[0].authStatus = "relogin_required"

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
    expect(add.parentElement).toHaveClass("sm:items-center")
    await userEvent.click(add)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })
})
