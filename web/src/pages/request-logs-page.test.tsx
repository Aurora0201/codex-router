import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Toaster } from "@/components/ui/toast"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import { RequestLogsPage } from "./request-logs-page"

describe("RequestLogsPage", () => {
  it("shows summaries, safe row metadata, and the details sheet", async () => {
    const service = createGatewayServiceFixture()
    service.getRequestLogs = vi.fn().mockResolvedValue({
      items: [{ id: "log-1", requestId: "req-1", route: "/responses", transport: "http", accountId: "account-1", accountLabel: "account-1@example.com", statusCode: 502, durationMs: 81, bytesIn: 120, bytesOut: 40, errorCode: "upstream_error", outcome: "upstream_error", scope: "request", identityMode: "managed_account", createdAt: Date.now() }],
      summary: { requests: 8, errors: 1, rejected: 0, cancelled: 0, availabilityRequests: 8, availabilityErrors: 1, averageDurationMs: 31 },
      timeline: [{ id: "log-1", createdAt: Date.now(), durationMs: 81, statusCode: 502, outcome: "upstream_error" }],
      nextCursor: null,
      pagination: { page: 1, pageSize: 20, totalItems: 8, totalPages: 1 },
    })
    render(<Toaster><RequestLogsPage service={service} accounts={service.snapshot.accounts.accounts} enabled initialErrorsOnly revision={0} onShowPreferences={vi.fn()} /></Toaster>)
    expect(await screen.findByText("8")).toBeInTheDocument()
    expect(screen.getByText("87.5%")).toBeInTheDocument()
    const availabilityHeading = screen.getByRole("heading", { name: "API 可用性" })
    expect(availabilityHeading).not.toHaveClass("text-lg")
    expect(screen.getByText("87.5%")).toHaveClass("text-base", "font-medium", "leading-snug")
    expect(within(availabilityHeading.closest('[data-slot="card"]')!).queryByText("部分错误")).not.toBeInTheDocument()
    expect(screen.getByText(/成功 7 \/ 有效 8/)).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "API 请求可用性阵列" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /1 个请求，1 个故障/ })).toHaveClass("h-4")
    expect(document.querySelectorAll('[data-slot="availability-bucket"]')).toHaveLength(96)
    expect(screen.queryByText("upstream_error")).not.toBeInTheDocument()
    expect(screen.getByText("上游故障").closest('[data-slot="badge"]')).toHaveAttribute("data-variant", "outline")
    expect(screen.getByRole("columnheader", { name: "时间与状态" })).toHaveStyle({ width: "250px" })
    expect(screen.getByRole("columnheader", { name: "耗时" })).toHaveClass("h-11", "py-0", "align-middle")
    expect(screen.getByRole("columnheader", { name: "耗时" })).not.toHaveClass("text-right")
    expect(screen.getByText("81 ms")).not.toHaveClass("text-right")
    expect(screen.getByText("120 B / 40 B")).not.toHaveClass("text-right")
    expect(screen.getByText("请求记录").closest('[data-slot="card"]')).toHaveClass("gap-0")
    expect(screen.getByText("请求记录").closest('[data-slot="card"]')?.querySelector('[data-slot="card-content"]')).toHaveClass("p-0")
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
    const requestLogs = vi.fn().mockResolvedValue({ items: [], summary: { requests: 0, errors: 0, rejected: 0, cancelled: 0, availabilityRequests: 0, availabilityErrors: 0, averageDurationMs: null }, timeline: [], nextCursor: null, pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 } })
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

  it("labels and filters Codex client passthrough requests", async () => {
    const service = createGatewayServiceFixture()
    const requestLogs = vi.fn().mockResolvedValue({
      items: [{ id: "passthrough", route: "/models", transport: "models", accountLabel: null, statusCode: 200, durationMs: 12, outcome: "success", scope: "request", identityMode: "client_passthrough", createdAt: Date.now() }],
      summary: { requests: 1, errors: 0, rejected: 0, cancelled: 0, availabilityRequests: 1, availabilityErrors: 0, averageDurationMs: 12 },
      timeline: [], nextCursor: null,
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    })
    service.getRequestLogs = requestLogs
    render(<RequestLogsPage service={service} accounts={[]} enabled initialErrorsOnly={false} revision={0} onShowPreferences={vi.fn()} />)
    expect(await screen.findByText("Codex 默认账号")).toBeInTheDocument()
    const input = screen.getByRole("combobox", { name: "账号筛选" })
    await userEvent.click(input)
    await userEvent.click(await screen.findByRole("option", { name: "Codex 默认账号" }))
    await waitFor(() => expect(requestLogs).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: "__client_passthrough__" })))
  })

  it("uses numbered server pagination with direct middle-page access", async () => {
    const service = createGatewayServiceFixture()
    service.getRequestLogs = vi.fn().mockImplementation(async (filters) => ({
      items: [{ id: `log-${filters.page}`, route: "/responses", transport: "http", accountLabel: "account@example.com", statusCode: 200, durationMs: 10, outcome: "success", scope: "request", identityMode: "managed_account", createdAt: Date.now() }],
      summary: { requests: 200, errors: 0, rejected: 0, cancelled: 0, availabilityRequests: 200, availabilityErrors: 0, averageDurationMs: 10 },
      timeline: [],
      nextCursor: null,
      pagination: { page: filters.page ?? 1, pageSize: 20, totalItems: 200, totalPages: 10 },
    }))
    render(<RequestLogsPage service={service} accounts={[]} enabled initialErrorsOnly={false} revision={0} onShowPreferences={vi.fn()} />)
    await screen.findByText("共 200 条 · 每页 20 条")
    await userEvent.click(screen.getByLabelText("第 5 页"))
    await waitFor(() => expect(service.getRequestLogs).toHaveBeenLastCalledWith(expect.objectContaining({ page: 5, limit: 20 })))
    expect(await screen.findByLabelText("第 5 页")).toHaveAttribute("aria-current", "page")
    expect(screen.getAllByText("More pages")).toHaveLength(2)
    expect(screen.getByText("共 200 条 · 每页 20 条")).toBeInTheDocument()
  })

  it("shows an undefined availability when no requests match", async () => {
    const service = createGatewayServiceFixture()
    render(<RequestLogsPage service={service} accounts={[]} enabled initialErrorsOnly={false} revision={0} onShowPreferences={vi.fn()} />)
    expect(await screen.findByText(/成功 0 \/ 有效 0/)).toBeInTheDocument()
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
  })

  it("uses semantic success, warning, destructive, and empty availability states", async () => {
    const service = createGatewayServiceFixture()
    const now = Date.now()
    service.getRequestLogs = vi.fn().mockResolvedValue({
      items: [],
      summary: { requests: 4, errors: 2, rejected: 0, cancelled: 0, availabilityRequests: 4, availabilityErrors: 2, averageDurationMs: 20 },
      timeline: [
        { id: "success", createdAt: now - 60_000, durationMs: 10, statusCode: 200, outcome: "success" },
        { id: "mixed-success", createdAt: now - 16 * 60_000, durationMs: 20, statusCode: 200, outcome: "success" },
        { id: "mixed-error", createdAt: now - 17 * 60_000, durationMs: 30, statusCode: 500, outcome: "upstream_error" },
        { id: "error", createdAt: now - 32 * 60_000, durationMs: 20, statusCode: 502, outcome: "upstream_error" },
      ],
      nextCursor: null,
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    })
    render(<RequestLogsPage service={service} accounts={[]} enabled initialErrorsOnly={false} revision={0} onShowPreferences={vi.fn()} />)
    await screen.findByText("50.0%")
    expect(document.querySelector('[data-state="success"]')).toHaveClass("bg-success/80")
    expect(document.querySelector('[data-state="mixed"]')).toHaveClass("bg-warning/85")
    expect(document.querySelector('[data-state="error"]')).toHaveClass("bg-destructive/85")
    expect(document.querySelector('[data-state="empty"]')).toHaveClass("bg-muted")
    expect(screen.queryByText("部分错误")).not.toBeInTheDocument()
  })
})
