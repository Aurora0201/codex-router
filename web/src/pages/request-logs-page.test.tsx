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
      items: [
        {
          id: "log-1",
          requestId: "req-1",
          route: "/responses",
          transport: "http",
          accountId: "account-1",
          accountLabel: "account-1@example.com",
          state: "failed",
          outcome: "upstream_error",
          failureSource: "upstream_protocol",
          failureStage: "terminal",
          httpStatus: null,
          protocolErrorCode: "rate_limit_exceeded",
          diagnosticCode: null,
          upstreamRequestId: "upstream-1",
          diagnosticHeaders: {},
          transportErrorChain: [
            { name: "ConnectTimeoutError", code: "UND_ERR_CONNECT_TIMEOUT" },
            { name: "Error", code: "ETIMEDOUT" },
          ],
          statusCode: null,
          errorCode: "rate_limit_exceeded",
          durationMs: 81,
          bytesIn: 120,
          bytesOut: 40,
          identityMode: "managed_account",
          startedAt: Date.now(),
          completedAt: Date.now(),
        },
      ],
      summary: {
        requests: 8,
        errors: 1,
        rejected: 0,
        cancelled: 0,
        availabilityRequests: 8,
        availabilityErrors: 1,
        averageDurationMs: 31,
      },
      timeline: [
        {
          id: "log-1",
          createdAt: Date.now(),
          durationMs: 81,
          statusCode: 502,
          outcome: "upstream_error",
        },
      ],
      nextCursor: null,
      pagination: { page: 1, pageSize: 20, totalItems: 8, totalPages: 1 },
    })
    render(
      <Toaster>
        <RequestLogsPage
          service={service}
          accounts={service.snapshot.accounts.accounts}
          enabled
          initialErrorsOnly
          revision={0}
          onShowPreferences={vi.fn()}
        />
      </Toaster>
    )
    expect(await screen.findByText("8")).toBeInTheDocument()
    expect(screen.queryByText("upstream_error")).not.toBeInTheDocument()
    expect(
      screen
        .getAllByText("上游故障")
        .find((item) => item.closest('[data-slot="badge"]'))
        ?.closest('[data-slot="badge"]')
    ).toHaveAttribute("data-variant", "outline")
    expect(
      screen.getByRole("columnheader", { name: "时间与状态" })
    ).toHaveStyle({ width: "280px" })
    expect(screen.getByRole("columnheader", { name: "耗时" })).toHaveClass(
      "h-11",
      "py-0",
      "align-middle"
    )
    expect(screen.getByRole("columnheader", { name: "耗时" })).not.toHaveClass(
      "text-right"
    )
    expect(screen.getByText("81 ms")).not.toHaveClass("text-right")
    expect(screen.getByText("120 B / 40 B")).not.toHaveClass("text-right")
    expect(
      screen.getByText("请求记录").closest('[data-slot="card"]')
    ).toHaveClass("gap-0")
    expect(
      screen
        .getByText("请求记录")
        .closest('[data-slot="card"]')
        ?.querySelector('[data-slot="card-content"]')
    ).toHaveClass("p-0")
    expect(
      screen
        .getByRole("button", { name: "查看请求 req-1" })
        .closest("[data-slot=scroll-area]")
    ).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole("button", { name: "查看请求 req-1" })
    )
    expect(await screen.findByText("请求详情")).toBeInTheDocument()
    expect(screen.getByText("rate_limit_exceeded")).toBeInTheDocument()
    expect(screen.getByText("upstream_protocol")).toBeInTheDocument()
    expect(screen.getByText("upstream-1")).toBeInTheDocument()
    expect(
      screen.getByText(
        "ConnectTimeoutError:UND_ERR_CONNECT_TIMEOUT → Error:ETIMEDOUT"
      )
    ).toBeInTheDocument()
    expect(
      screen
        .getByRole("button", { name: "关闭" })
        .closest("[data-slot=sheet-footer]")
    ).toBeInTheDocument()
    expect(
      JSON.stringify(await service.getRequestLogs({ range: "24h" }))
    ).not.toContain("prompt")
  })

  it("links to preferences when metadata recording is disabled", async () => {
    const service = createGatewayServiceFixture()
    const onShowPreferences = vi.fn()
    render(
      <RequestLogsPage
        service={service}
        accounts={[]}
        enabled={false}
        initialErrorsOnly={false}
        revision={0}
        onShowPreferences={onShowPreferences}
      />
    )
    expect(screen.getByText("请求元数据记录已关闭")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "前往偏好设置" }))
    await waitFor(() => expect(onShowPreferences).toHaveBeenCalledOnce())
  })

  it("searches long account labels with the account Combobox", async () => {
    const service = createGatewayServiceFixture()
    service.snapshot.accounts.accounts[1].email =
      "a-very-long-account-name@example.enterprise.test"
    const requestLogs = vi
      .fn()
      .mockResolvedValue({
        items: [],
        summary: {
          requests: 0,
          errors: 0,
          rejected: 0,
          cancelled: 0,
          availabilityRequests: 0,
          availabilityErrors: 0,
          averageDurationMs: null,
        },
        timeline: [],
        nextCursor: null,
        pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
      })
    service.getRequestLogs = requestLogs
    render(
      <RequestLogsPage
        service={service}
        accounts={service.snapshot.accounts.accounts}
        enabled
        initialErrorsOnly={false}
        revision={0}
        onShowPreferences={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole("button", { name: "更多筛选" }))
    const input = screen.getByRole("combobox", { name: "账号筛选" })
    await userEvent.click(input)
    await userEvent.clear(input)
    await userEvent.type(input, "very-long")
    const option = await screen.findByRole("option", {
      name: "a-very-long-account-name@example.enterprise.test",
    })
    await userEvent.click(option)
    await waitFor(() =>
      expect(requestLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "account-2" })
      )
    )
  })

  it("labels and filters Codex client passthrough requests", async () => {
    const service = createGatewayServiceFixture()
    const requestLogs = vi.fn().mockResolvedValue({
      items: [
        {
          id: "passthrough",
          route: "/models",
          transport: "models",
          accountLabel: null,
          state: "completed",
          outcome: "success",
          failureSource: null,
          failureStage: null,
          httpStatus: 200,
          protocolErrorCode: null,
          diagnosticCode: null,
          upstreamRequestId: null,
          diagnosticHeaders: {},
          statusCode: 200,
          errorCode: null,
          durationMs: 12,
          identityMode: "client_passthrough",
          startedAt: Date.now(),
          completedAt: Date.now(),
          bytesIn: 0,
          bytesOut: 0,
        },
      ],
      summary: {
        requests: 1,
        errors: 0,
        rejected: 0,
        cancelled: 0,
        availabilityRequests: 1,
        availabilityErrors: 0,
        averageDurationMs: 12,
      },
      timeline: [],
      nextCursor: null,
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    })
    service.getRequestLogs = requestLogs
    render(
      <RequestLogsPage
        service={service}
        accounts={[]}
        enabled
        initialErrorsOnly={false}
        revision={0}
        onShowPreferences={vi.fn()}
      />
    )
    expect(await screen.findByText("Codex 默认账号")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "更多筛选" }))
    const input = screen.getByRole("combobox", { name: "账号筛选" })
    await userEvent.click(input)
    await userEvent.click(
      await screen.findByRole("option", { name: "Codex 默认账号" })
    )
    await waitFor(() =>
      expect(requestLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ accountId: "__client_passthrough__" })
      )
    )
  })

  it("uses numbered server pagination with direct middle-page access", async () => {
    const service = createGatewayServiceFixture()
    service.getRequestLogs = vi.fn().mockImplementation(async (filters) => ({
      items: [
        {
          id: `log-${filters.page}`,
          route: "/responses",
          transport: "http",
          accountLabel: "account@example.com",
          state: "completed",
          outcome: "success",
          failureSource: null,
          failureStage: null,
          httpStatus: 200,
          protocolErrorCode: null,
          diagnosticCode: null,
          upstreamRequestId: null,
          diagnosticHeaders: {},
          statusCode: 200,
          errorCode: null,
          durationMs: 10,
          identityMode: "managed_account",
          startedAt: Date.now(),
          completedAt: Date.now(),
          bytesIn: 0,
          bytesOut: 0,
        },
      ],
      summary: {
        requests: 200,
        errors: 0,
        rejected: 0,
        cancelled: 0,
        availabilityRequests: 200,
        availabilityErrors: 0,
        averageDurationMs: 10,
      },
      timeline: [],
      nextCursor: null,
      pagination: {
        page: filters.page ?? 1,
        pageSize: 20,
        totalItems: 200,
        totalPages: 10,
      },
    }))
    render(
      <RequestLogsPage
        service={service}
        accounts={[]}
        enabled
        initialErrorsOnly={false}
        revision={0}
        onShowPreferences={vi.fn()}
      />
    )
    await screen.findByText("共 200 条 · 每页 20 条")
    await userEvent.click(screen.getByLabelText("第 5 页"))
    await waitFor(() =>
      expect(service.getRequestLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 5, limit: 20 })
      )
    )
    expect(await screen.findByLabelText("第 5 页")).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(screen.getAllByText("More pages")).toHaveLength(2)
    expect(screen.getByText("共 200 条 · 每页 20 条")).toBeInTheDocument()
  })

  it("shows an empty request state when no requests match", async () => {
    const service = createGatewayServiceFixture()
    render(
      <RequestLogsPage
        service={service}
        accounts={[]}
        enabled
        initialErrorsOnly={false}
        revision={0}
        onShowPreferences={vi.fn()}
      />
    )
    expect(await screen.findByText("没有匹配的请求记录")).toBeInTheDocument()
  })

  it("keeps connection diagnostics separate from request rows", async () => {
    const service = createGatewayServiceFixture()
    service.getWebSocketConnectionLogs = vi
      .fn()
      .mockResolvedValue({
        items: [
          {
            id: "connection-log-1",
            connectionId: "connection-1",
            accountLabel: null,
            identityMode: "client_passthrough",
            startedAt: Date.now(),
            handshakeHttpStatus: 101,
            outcome: "retired",
            closeReasonCode: "account_switch_connection_retired",
          },
        ],
        summary: { connections: 1, failures: 0, retired: 1 },
        nextCursor: null,
        pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
      })
    render(
      <RequestLogsPage
        service={service}
        accounts={[]}
        enabled
        initialErrorsOnly={false}
        revision={0}
        onShowPreferences={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole("tab", { name: "连接诊断" }))
    expect(await screen.findByText("connection-1")).toBeInTheDocument()
    expect(screen.getByText("101")).toBeInTheDocument()
    expect(screen.getAllByText("正常退役").length).toBeGreaterThanOrEqual(2)
  })
})
