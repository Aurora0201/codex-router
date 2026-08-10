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
      nextCursor: null,
    })
    render(<Toaster><RequestLogsPage service={service} accounts={service.snapshot.accounts.accounts} enabled initialErrorsOnly revision={0} onShowPreferences={vi.fn()} /></Toaster>)
    expect(await screen.findByText("8")).toBeInTheDocument()
    expect(screen.queryByText("upstream_error")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "查看请求 req-1" }))
    expect(await screen.findByText("请求详情")).toBeInTheDocument()
    expect(screen.getByText("upstream_error")).toBeInTheDocument()
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
})
