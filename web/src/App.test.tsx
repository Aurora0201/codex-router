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
    expect(
      screen.getAllByRole("radio", { name: /设为当前路由/ })
    ).not.toHaveLength(0)
    expect(screen.queryByText("Manual routing")).not.toBeInTheDocument()
    expect(screen.queryByText("实时路由")).not.toBeInTheDocument()
    expect(screen.queryByText("运行概览")).not.toBeInTheDocument()
    expect(
      screen.getByRole("textbox", { name: "搜索授权账号" })
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "运行状态" }))
    expect(
      await screen.findByRole("heading", { name: "运行状态" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "请求元数据记录" })).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "偏好设置" }))
    expect(screen.getByRole("switch", { name: "请求元数据记录" })).toBeChecked()
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
