import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { Toaster } from "@/components/ui/toast"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import { RequestLogsPage } from "./request-logs-page"

describe("RequestLogsPage", () => {
  it("marks a row as new only when it arrives on the page already on screen", async () => {
    const user = userEvent.setup()
    const service = createGatewayServiceFixture()
    const item = (id: string) => ({
      id,
      requestId: id,
      route: "/responses",
      transport: "http" as const,
      accountId: "account-1",
      accountLabel: "account-1@example.com",
      state: "succeeded" as const,
      outcome: "success" as const,
      failureSource: null,
      failureStage: null,
      httpStatus: 200,
      protocolErrorCode: null,
      diagnosticCode: null,
      upstreamRequestId: null,
      diagnosticHeaders: {},
      transportErrorChain: [],
      statusCode: 200,
      errorCode: null,
      durationMs: 40,
      bytesIn: 10,
      bytesOut: 20,
      identityMode: "managed_account" as const,
      startedAt: Date.now(),
      completedAt: Date.now(),
    })
    const answer = (ids: string[]) => ({
      items: ids.map(item),
      summary: {
        requests: ids.length,
        errors: 0,
        rejected: 0,
        cancelled: 0,
        availabilityRequests: ids.length,
        availabilityErrors: 0,
        averageDurationMs: 40,
      },
      timeline: [],
      histogram: [],
      failureSources: [],
      diagnosticCodes: [],
      nextCursor: null,
      pagination: {
        page: 1,
        pageSize: 20,
        totalItems: ids.length,
        totalPages: 1,
      },
    })
    const getRequestLogs = vi.fn().mockResolvedValue(answer(["log-1", "log-2"]))
    service.getRequestLogs = getRequestLogs
    const props = {
      service,
      accounts: service.snapshot.accounts.accounts,
      enabled: true,
      initialErrorsOnly: false,
      onShowPreferences: () => {},
    }
    const { rerender } = render(
      <Toaster>
        <RequestLogsPage {...props} revision={0} />
      </Toaster>
    )
    const rows = () => document.querySelectorAll("tbody tr").length
    const marked = () => document.querySelectorAll("tbody tr.animate-in").length

    // The first page to arrive is not an arrival, it is the answer.
    await waitFor(() => expect(rows()).toBe(2))
    expect(marked()).toBe(0)

    // Neither is a different question, even though every row is different.
    getRequestLogs.mockResolvedValue(answer(["log-3", "log-4"]))
    await user.click(screen.getByRole("tab", { name: "故障" }))
    await waitFor(() =>
      expect(getRequestLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "error" })
      )
    )
    await waitFor(() => expect(rows()).toBe(2))
    expect(marked()).toBe(0)

    // A refresh of the page on screen is: the row that was not there before
    // is the only one that announces itself.
    getRequestLogs.mockResolvedValue(answer(["log-5", "log-3", "log-4"]))
    rerender(
      <Toaster>
        <RequestLogsPage {...props} revision={1} />
      </Toaster>
    )
    await waitFor(() => expect(rows()).toBe(3))
    await waitFor(() => expect(marked()).toBe(1))

    // The next snapshot naturally retires the arrival marker; no wall-clock
    // timeout can erase it before a slow client has rendered the row.
    rerender(
      <Toaster>
        <RequestLogsPage {...props} revision={2} />
      </Toaster>
    )
    await waitFor(() => expect(marked()).toBe(0))
  })

  it("puts the coarse slice in the toolbar and every hidden filter on a chip", async () => {
    const user = userEvent.setup()
    const service = createGatewayServiceFixture()
    const getRequestLogs = vi.fn().mockResolvedValue({
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
      histogram: [],
      failureSources: [{ source: "upstream_http", count: 3 }],
      diagnosticCodes: [],
      nextCursor: null,
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    })
    service.getRequestLogs = getRequestLogs
    render(
      <Toaster>
        <RequestLogsPage
          service={service}
          accounts={service.snapshot.accounts.accounts}
          enabled
          initialErrorsOnly={false}
          revision={0}
          onShowPreferences={() => {}}
        />
      </Toaster>
    )

    // "Show me the failures" is the common move, so it is one click in the
    // toolbar rather than a select buried among the rare filters.
    const tabs = await screen.findByRole("tablist", { name: "请求结果筛选" })
    expect(tabs).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "故障" }))
    await waitFor(() =>
      expect(getRequestLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "error" })
      )
    )
    // A tab shows its own state, so it needs no chip.
    expect(screen.queryByRole("button", { name: /移除筛选/ })).toBeNull()

    // Anything set out of sight does get one, and the chip lives in the
    // toolbar rather than inside the popover that set it.
    await user.click(screen.getByRole("button", { name: /上游 HTTP/ }))
    const chip = await screen.findByRole("button", {
      name: "移除筛选 upstream_http",
    })
    expect(chip.closest("[data-slot=popover-content]")).toBeNull()
    await waitFor(() =>
      expect(getRequestLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ failureSource: "upstream_http" })
      )
    )

    // Removing the chip drops the field entirely rather than sending it as
    // undefined, so the query stops carrying it at all.
    await user.click(chip)
    await waitFor(() =>
      expect(getRequestLogs.mock.lastCall?.[0]).not.toHaveProperty(
        "failureSource"
      )
    )
  })

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
      histogram: [],
      failureSources: [],
      diagnosticCodes: [],
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
    expect(document.querySelector("colgroup col:first-child")).toHaveClass(
      "w-[280px]"
    )
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
    // The card owns the outline while the complete table surface owns the
    // muted background.
    const records = screen
      .getByRole("heading", { name: "请求记录" })
      .closest("section") as HTMLElement
    expect(records.closest('[role="tabpanel"]')).toHaveClass("pb-4")
    expect(records).toContainElement(
      screen.getByRole("button", { name: "更多筛选" })
    )
    expect(records).toContainElement(
      screen.getByRole("button", { name: "查看请求 req-1" })
    )
    expect(records).toHaveClass("bg-card", "ring-1")
    expect(records).not.toHaveClass("bg-muted")
    const recordsScrollArea = screen
      .getByRole("button", { name: "查看请求 req-1" })
      .closest("[data-slot=scroll-area]")
    expect(recordsScrollArea).toHaveClass("h-[520px]")
    expect(recordsScrollArea?.parentElement).toHaveClass("bg-muted")
    expect(recordsScrollArea?.parentElement).not.toHaveClass("mx-3", "mb-3")
    expect(
      screen.getByRole("columnheader", { name: "路由" }).closest("thead")
    ).toHaveClass("[&_th]:bg-muted")
    expect(screen.getByText("POST")).toHaveClass("text-primary")
    expect(screen.getByTitle("POST /responses")).toBeInTheDocument()
    // Fixed, and tall enough for the most the panel can be asked to hold:
    // five failure sources and three codes measure 255px against 268 of body.
    // At h-72 they had 236 and the panel scrolled its own contents away.
    const failurePanel = screen
      .getByRole("heading", { name: "故障分布" })
      .closest("section")
    const volumeHero = screen.getByText("最近 24 小时的请求").closest("section")
    expect(failurePanel).toHaveClass("xl:h-80")
    expect(volumeHero).toHaveClass("xl:h-80")
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

  it("shows the real request protocol beside each route", async () => {
    const service = createGatewayServiceFixture()
    const baseItem = {
      accountLabel: "account@example.com",
      state: "completed" as const,
      outcome: "success" as const,
      identityMode: "managed_account" as const,
      startedAt: Date.now(),
      completedAt: Date.now(),
      bytesIn: 0,
      bytesOut: 0,
    }
    service.getRequestLogs = vi.fn().mockResolvedValue({
      items: [
        {
          ...baseItem,
          id: "http-response",
          route: "/responses",
          transport: "http",
        },
        {
          ...baseItem,
          id: "models",
          route: "/models",
          transport: "models",
        },
        {
          ...baseItem,
          id: "ws-response",
          route: "/responses",
          transport: "ws",
        },
        {
          ...baseItem,
          id: "ws-compact",
          requestId: "connection-id:1",
          route: "/responses",
          transport: "compact",
        },
      ],
      summary: {
        requests: 4,
        errors: 0,
        rejected: 0,
        cancelled: 0,
        availabilityRequests: 4,
        availabilityErrors: 0,
        averageDurationMs: 1,
      },
      timeline: [],
      histogram: [],
      failureSources: [],
      diagnosticCodes: [],
      nextCursor: null,
      pagination: { page: 1, pageSize: 20, totalItems: 4, totalPages: 1 },
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

    expect(await screen.findByTitle("POST /responses")).toBeInTheDocument()
    expect(screen.getByTitle("GET /models")).toBeInTheDocument()
    expect(screen.getAllByTitle("WS /responses")).toHaveLength(2)
  })

  it("applies and clears a local whole-day date range", async () => {
    const user = userEvent.setup()
    const service = createGatewayServiceFixture()
    const getRequestLogs = vi.fn(service.getRequestLogs.bind(service))
    service.getRequestLogs = getRequestLogs
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

    await user.click(screen.getByRole("button", { name: "更多筛选" }))
    await user.click(screen.getByRole("button", { name: "日期范围" }))
    const availableDays = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        '[data-slot="calendar"] button[data-day]'
      )
    ).filter((button) => !button.closest('[data-outside="true"]'))
    const first = availableDays[7]
    const last = availableDays[9]
    expect(first).toBeDefined()
    expect(last).toBeDefined()
    const firstDay = first!.dataset.day!
    const lastDay = last!.dataset.day!
    await user.click(first!)
    await waitFor(() => {
      const firstButton = document.querySelector<HTMLButtonElement>(
        `[data-slot="calendar"] button[data-day="${firstDay}"]`
      )
      expect(firstButton).toHaveAttribute("data-range-start", "true")
    })
    const lastButton = document.querySelector<HTMLButtonElement>(
      `[data-slot="calendar"] button[data-day="${lastDay}"]`
    )!
    await user.click(lastButton)
    await waitFor(() => {
      const firstButton = document.querySelector<HTMLButtonElement>(
        `[data-slot="calendar"] button[data-day="${firstDay}"]`
      )
      const lastButton = document.querySelector<HTMLButtonElement>(
        `[data-slot="calendar"] button[data-day="${lastDay}"]`
      )
      expect(firstButton).toHaveAttribute("data-range-start", "true")
      expect(lastButton).toHaveAttribute("data-range-end", "true")
    })
    await user.click(screen.getByRole("button", { name: "保存" }))

    const parseDay = (value: string) => {
      const [year, month, day] = value.split("/").map(Number)
      return new Date(year, month - 1, day)
    }
    const firstDate = parseDay(firstDay)
    const lastDate = parseDay(lastDay)
    await waitFor(() =>
      expect(getRequestLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({
          from: new Date(
            firstDate.getFullYear(),
            firstDate.getMonth(),
            firstDate.getDate()
          ).getTime(),
          to: new Date(
            lastDate.getFullYear(),
            lastDate.getMonth(),
            lastDate.getDate(),
            23,
            59,
            59,
            999
          ).getTime(),
          page: 1,
        })
      )
    )

    const rangeChip = await screen.findByRole("button", {
      name: /移除筛选.*至/,
    })
    await user.click(rangeChip)
    await waitFor(() => {
      expect(getRequestLogs.mock.lastCall?.[0]).not.toHaveProperty("from")
      expect(getRequestLogs.mock.lastCall?.[0]).not.toHaveProperty("to")
    })
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
    const requestLogs = vi.fn().mockResolvedValue({
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
      histogram: [],
      failureSources: [],
      diagnosticCodes: [],
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
      histogram: [],
      failureSources: [],
      diagnosticCodes: [],
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
      histogram: [],
      failureSources: [],
      diagnosticCodes: [],
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
    const bucketStartedAt = Date.now() - 60_000
    const bucketEndedAt = Date.now()
    service.getWebSocketConnectionLogs = vi.fn().mockResolvedValue({
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
      histogram: [
        {
          startedAt: bucketStartedAt,
          endedAt: bucketEndedAt,
          connections: 1,
          failures: 0,
          retired: 1,
        },
      ],
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
    const connectionTab = screen.getByRole("tab", { name: "连接诊断" })
    await userEvent.click(connectionTab)
    expect(await screen.findByText("connection-1")).toBeInTheDocument()
    expect(
      screen
        .getByText("connection-1")
        .closest('[data-slot="animate-tabs-panel"]')
    ).toHaveClass("flex", "flex-col", "gap-4", "pb-4")
    const tabsPanels = document.querySelector(
      '[data-slot="animate-tabs-panels"]'
    )
    expect(tabsPanels).toHaveClass("min-h-0", "flex-1")
    expect(tabsPanels).toHaveStyle({ overflow: "visible" })
    expect(screen.getByText("101")).toBeInTheDocument()
    expect(screen.getAllByText("正常退役").length).toBeGreaterThanOrEqual(2)
    const overview = screen.getByRole("group", {
      name: "连接量与结果的时间分布",
    })
    expect(overview.closest("section")).toHaveClass(
      "xl:col-span-8",
      "xl:h-72",
      "bg-emphasis"
    )
    expect(screen.getByText("连接结果分布").closest("section")).toHaveClass(
      "xl:col-span-4",
      "xl:h-72"
    )
    const connectionBucket = screen.getByRole("button", {
      name: /连接 1 · 故障 0/,
    })
    await userEvent.click(connectionBucket)
    await waitFor(() =>
      expect(service.getWebSocketConnectionLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({
          from: bucketStartedAt,
          to: bucketEndedAt,
          page: 1,
        })
      )
    )
    const diagnosticsSection = screen
      .getByText("WebSocket 连接诊断")
      .closest("section") as HTMLElement
    expect(diagnosticsSection).toHaveClass(
      "rounded-2xl",
      "bg-card",
      "p-2",
      "ring-1"
    )
    const moreFilters = screen.getByRole("button", { name: /^更多筛选/ })
    expect(diagnosticsSection).toContainElement(moreFilters)
    expect(screen.getByRole("searchbox", { name: "搜索连接" })).toHaveClass(
      "bg-transparent"
    )
    expect(
      screen.getByText("connection-1").closest("div.overflow-hidden")
    ).toHaveClass("rounded-lg", "bg-muted")
    expect(
      screen.getByText("connection-1").closest('[data-slot="scroll-area"]')
    ).toHaveClass("h-[520px]")
    await userEvent.click(moreFilters)
    expect(
      await screen.findByRole("button", { name: "日期范围" })
    ).toBeInTheDocument()
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull()
  })
})
