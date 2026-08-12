import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toast"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import { RequestAvailabilityCard } from "./request-availability-card"

describe("RequestAvailabilityCard", () => {
  it("keeps loaded data when the selected range is chosen again", async () => {
    const user = userEvent.setup()
    const service = createGatewayServiceFixture()
    service.getRequestLogs = vi.fn(async () => ({
      items: [],
      summary: { requests: 1, errors: 0, rejected: 0, cancelled: 0, availabilityRequests: 1, availabilityErrors: 0, averageDurationMs: 10 },
      timeline: [{ id: "request-1", createdAt: Date.now(), outcome: "success" as const, durationMs: 10, statusCode: 200 }],
      nextCursor: null,
      pagination: { page: 1, pageSize: 1, totalItems: 1, totalPages: 1 },
    }))
    render(<ThemeProvider><Toaster><RequestAvailabilityCard service={service} enabled revision={0} /></Toaster></ThemeProvider>)

    expect(await screen.findByText("100.0%")).toBeInTheDocument()
    await user.click(screen.getByRole("combobox", { name: "时间范围" }))
    await user.click(screen.getByRole("option", { name: "最近 24 小时" }))

    expect(screen.getByText("100.0%")).toBeInTheDocument()
    expect(service.getRequestLogs).toHaveBeenCalledTimes(1)
  })
})
