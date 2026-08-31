import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import App from "./App"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"

function renderApp(service = createGatewayServiceFixture()) {
  return render(
    <ThemeProvider>
      <Toaster>
        <TooltipProvider>
          <App service={service} />
        </TooltipProvider>
      </Toaster>
    </ThemeProvider>
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("App", () => {
  it("loads the account console and switches pages through the shadcn Sidebar", async () => {
    const user = userEvent.setup()
    renderApp()
    expect(
      await screen.findByRole("heading", { name: "账号与路由" })
    ).toBeInTheDocument()
    expect(screen.getAllByRole("radio", { name: /^路由到 / })).not.toHaveLength(
      0
    )
    expect(screen.queryByText("Manual routing")).not.toBeInTheDocument()
    expect(screen.queryByText("实时路由")).not.toBeInTheDocument()
    expect(screen.queryByText("运行概览")).not.toBeInTheDocument()
    expect(
      screen.getByRole("searchbox", { name: "搜索授权账号" })
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "运行状态" }))
    expect(
      await screen.findByRole("heading", { name: "运行状态" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("switch", { name: "请求元数据记录" })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "偏好设置" }))
    expect(screen.getByRole("switch", { name: "请求元数据记录" })).toBeChecked()
  })

  it("switches pages on the g chord, and never while you are typing", async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole("heading", { name: "账号与路由" })

    // The nav prints "G U" on the row, so the chord has to actually work —
    // modifier digits could not, because every browser reserves Cmd/Ctrl+1-8.
    await user.keyboard("gu")
    expect(
      await screen.findByRole("heading", { name: "用量分析" })
    ).toBeInTheDocument()

    await user.keyboard("gr")
    await screen.findByRole("heading", { name: "运行状态" })
    await user.keyboard("ga")
    await screen.findByRole("heading", { name: "账号与路由" })

    // A search field swallows the same keys: navigating out from under
    // someone's cursor is the one thing a shortcut must not do.
    const search = screen.getByRole("searchbox", { name: "搜索授权账号" })
    await user.click(search)
    await user.keyboard("gu")
    expect(search).toHaveValue("gu")
    expect(
      screen.getByRole("heading", { name: "账号与路由" })
    ).toBeInTheDocument()
  })

  it("uses one desktop top inset for regular and fixed-height pages", async () => {
    const user = userEvent.setup()
    renderApp()
    const accountHeading = await screen.findByRole("heading", {
      name: "账号与路由",
    })
    const pageContent = accountHeading.closest("section")?.parentElement

    // Accounts is a fixed-height page: its list scrolls inside its own card.
    expect(pageContent).toHaveClass("lg:h-full", "lg:py-4")
    expect(pageContent).not.toHaveClass("lg:py-8")

    // The runtime page is a grid taller than the viewport, so it scrolls as a
    // page rather than pinning itself and scrolling inside.
    await user.click(screen.getByRole("button", { name: "运行状态" }))
    await screen.findByRole("heading", { name: "运行状态" })
    expect(pageContent).toHaveClass("lg:py-4")
    expect(pageContent).not.toHaveClass("lg:h-full")

    await user.click(screen.getByRole("button", { name: "请求日志" }))
    await screen.findByRole("heading", { name: "请求日志" })
    expect(pageContent).toHaveClass("lg:h-full", "lg:py-4")

    await user.click(screen.getByRole("button", { name: "偏好设置" }))
    await screen.findByRole("heading", { name: "偏好设置" })
    expect(pageContent).toHaveClass("lg:py-4")
    expect(pageContent).not.toHaveClass("lg:h-full")
  })

  it("keeps the last snapshot while offline and recovers on polling", async () => {
    vi.useFakeTimers()
    const service = createGatewayServiceFixture()
    const getSnapshot = vi
      .spyOn(service, "getSnapshot")
      .mockResolvedValueOnce(structuredClone(service.snapshot))
      .mockRejectedValueOnce(new Error("gateway_offline"))
      .mockResolvedValue(structuredClone(service.snapshot))

    renderApp(service)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByRole("heading", { name: "账号与路由" })).toBeVisible()

    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(screen.getByRole("alert")).toHaveTextContent("gateway_offline")
    expect(screen.getByRole("heading", { name: "账号与路由" })).toBeVisible()

    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(getSnapshot).toHaveBeenCalledTimes(3)
  })

  it("pauses polling while hidden and refreshes when visible", async () => {
    vi.useFakeTimers()
    const service = createGatewayServiceFixture()
    const getSnapshot = vi.spyOn(service, "getSnapshot")
    let hidden = false
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden)

    renderApp(service)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(getSnapshot).toHaveBeenCalledOnce()

    hidden = true
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(getSnapshot).toHaveBeenCalledOnce()

    hidden = false
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      await Promise.resolve()
    })
    expect(getSnapshot).toHaveBeenCalledTimes(2)
  })
})
