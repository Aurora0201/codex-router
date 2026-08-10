import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Toaster } from "@/components/ui/toast"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import { RequestLogsPage } from "./request-logs-page"

describe("RequestLogsPage", () => {
  it("shows summaries, safe row metadata, and the details sheet", async () => {
    const service = createGatewayServiceFixture()
    service.getRequestLogs = vi.fn().mockResolvedValue({
      items: [{ id: "log-1", requestId: "req-1", route: "/responses", transport: "http", accountId: "account-1", accountLabel: "account-1@example.com", statusCode: 502, durationMs: 81, bytesIn: 120, bytesOut: 40, errorCode: "upstream_error", createdAt: Date.now() }],
      summary: { requests: 8, errors: 1, averageDurationMs: 31 },
      timeline: [{ id: "log-1", createdAt: Date.now(), durationMs: 81, statusCode: 502 }],
      nextCursor: null,
    })
    render(<Toaster><RequestLogsPage service={service} accounts={service.snapshot.accounts.accounts} enabled initialErrorsOnly revision={0} onShowPreferences={vi.fn()} /></Toaster>)
    expect(await screen.findByText("8")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "API 请求可用性阵列" })).toBeInTheDocument()
    expect(screen.queryByText("upstream_error")).not.toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "时间与状态" })).toHaveStyle({ width: "190px" })
    expect(screen.getByRole("button", { name: "查看请求 req-1" }).closest("[data-slot=scroll-area]")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "查看请求 req-1" }))
    expect(await screen.findByText("请求详情")).toBeInTheDocument()
    expect(screen.getByText("upstream_error")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "关闭" }).closest("[data-slot=sheet-footer]")).toBeInTheDocument()
    expect(JSON.stringify(await service.getRequestLogs({ range: "24h" }))).not.toContain("prompt")
  })

  it("links to preferences when metadata recording is disabled", async () => {
    const service = createGatewayServiceFixture()
    const onShowPreferences = vi.fn()
    render(<RequestLogsPage service={service} accounts={[]} enabled={false} initialErrorsOnly={false} revision={0} onShowPreferences={onShowPreferences} />)
    expect(screen.getByText("请求元数据记录已关闭")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "前往偏好设置" }))
    await waitFor(() => expect(onShowPreferences).toHaveBeenCalledOnce())
  })

  it("searches long account labels with the account Combobox", async () => {
    const service = createGatewayServiceFixture()
    service.snapshot.accounts.accounts[1].email = "a-very-long-account-name@example.enterprise.test"
    const requestLogs = vi.fn().mockResolvedValue({ ...service.snapshot, items: [], summary: { requests: 0, errors: 0, averageDurationMs: null }, timeline: [], nextCursor: null })
    service.getRequestLogs = requestLogs
    render(<RequestLogsPage service={service} accounts={service.snapshot.accounts.accounts} enabled initialErrorsOnly={false} revision={0} onShowPreferences={vi.fn()} />)
    const input = screen.getByRole("combobox", { name: "账号筛选" })
    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, "very-long")
    const option = await screen.findByRole("option", { name: "a-very-long-account-name@example.enterprise.test" })
    await userEvent.click(option)
    await waitFor(() => expect(requestLogs).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: "account-2" })))
  })

  it("uses cursor-backed previous and next pagination", async () => {
    const service = createGatewayServiceFixture()
    const first = { items: [], summary: { requests: 21, errors: 0, averageDurationMs: 10 }, timeline: [], nextCursor: "next-page" }
    const second = { ...first, nextCursor: null }
    service.getRequestLogs = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    render(<RequestLogsPage service={service} accounts={[]} enabled initialErrorsOnly={false} revision={0} onShowPreferences={vi.fn()} />)
    await userEvent.click(await screen.findByText("下一页"))
    expect(await screen.findByText("第 2 页")).toBeInTheDocument()
    expect(service.getRequestLogs).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "next-page", limit: 20 }))
    await userEvent.click(screen.getByText("上一页"))
    expect(screen.getByText("第 1 页")).toBeInTheDocument()
  })
})
