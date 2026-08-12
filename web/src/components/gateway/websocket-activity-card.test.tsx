import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { WebSocketConnectionView } from "@/services/contracts"
import { WebSocketActivityCard } from "./websocket-activity-card"

describe("WebSocketActivityCard", () => {
  it("renders live connection metadata and semantic states", () => {
    const now = Date.now()
    const connections: WebSocketConnectionView[] = [
      { connectionId: "connection-transmitting", state: "transmitting", connectedAt: now - 2_000, activeRequestId: "request-active" },
      { connectionId: "connection-idle", state: "idle", connectedAt: now - 5_000 },
      { connectionId: "connection-retiring", state: "retiring", connectedAt: now - 8_000 },
    ]

    render(<WebSocketActivityCard connections={connections} />)

    expect(screen.getByText("3 条连接 · 1 条传输中")).toBeInTheDocument()
    expect(screen.getByText("正在传输")).toHaveClass("shimmer", "text-success")
    expect(screen.getByText(/正在退役/)).toHaveClass("shimmer", "text-warning")
    expect(screen.getByText("空闲")).not.toHaveClass("shimmer")
    expect(screen.getByText(/request/)).toBeInTheDocument()
  })

  it("renders the empty state without mock copy", () => {
    render(<WebSocketActivityCard connections={[]} />)
    expect(screen.getByText("当前没有 WebSocket 连接")).toBeInTheDocument()
    expect(screen.queryByText(/Mock/)).not.toBeInTheDocument()
  })
})
