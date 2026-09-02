import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WebSocketConnectionView } from "@/services/contracts"
import { WebSocketActivityCard } from "./websocket-activity-card"

describe("WebSocketActivityCard", () => {
  afterEach(() => vi.useRealTimers())

  it("renders live connection metadata and semantic states", () => {
    const now = Date.now()
    const connections: WebSocketConnectionView[] = [
      {
        connectionId: "connection-transmitting",
        state: "transmitting",
        connectedAt: now - 2_000,
        activeRequestId: "request-active",
        sessionId: "session-active",
        threadId: "thread-1234567890",
        turnId: "turn-1234567890",
        activityKind: "response",
      },
      {
        connectionId: "connection-idle",
        state: "idle",
        connectedAt: now - 5_000,
      },
      {
        connectionId: "connection-retiring",
        state: "retiring",
        connectedAt: now - 8_000,
      },
    ]

    render(<WebSocketActivityCard connections={connections} />)

    expect(screen.getByText("3 条连接 · 1 条传输中")).toBeInTheDocument()
    expect(screen.getByText("正在传输")).toHaveClass("shimmer", "text-success")
    expect(screen.getByText(/正在退役/)).toHaveClass("shimmer", "text-warning")
    expect(screen.getByText("空闲")).not.toHaveClass("shimmer")
    expect(
      screen.getByRole("columnheader", { name: "对话" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("columnheader", { name: "当前活动" })
    ).toBeInTheDocument()
    expect(screen.getByText("thread-1…7890")).toBeInTheDocument()
    expect(
      screen.getByText("Turn turn-123…7890 · 模型响应")
    ).toBeInTheDocument()
    expect(screen.queryByText("request-active")).not.toBeInTheDocument()
  })

  it("renders the empty state without mock copy", () => {
    render(<WebSocketActivityCard connections={[]} />)
    expect(screen.getByText("当前没有 WebSocket 连接")).toBeInTheDocument()
    expect(screen.queryByText(/Mock/)).not.toBeInTheDocument()
  })

  it("falls back to a visible connection identifier when conversation metadata is unavailable", () => {
    render(
      <WebSocketActivityCard
        connections={[
          {
            connectionId: "connection-1234567890",
            state: "idle",
            connectedAt: Date.now(),
          },
        ]}
      />
    )
    expect(screen.getByText("connecti…7890")).toBeInTheDocument()
    expect(screen.getByText(/未关联/)).toBeInTheDocument()
  })

  it("reveals the sticky header shadow only after vertical scrolling", () => {
    const { container } = render(
      <WebSocketActivityCard
        connections={[
          {
            connectionId: "connection-idle",
            state: "idle",
            connectedAt: Date.now(),
          },
        ]}
      />
    )
    const viewport = container.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    )
    const shadow = container.querySelector<HTMLElement>(
      '[data-slot="sticky-header-shadow"]'
    )

    expect(viewport).not.toBeNull()
    if (!viewport) throw new Error("ScrollArea viewport not found")
    expect(shadow).toHaveClass("opacity-0")
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      value: 24,
    })
    fireEvent.scroll(viewport)
    expect(shadow).toHaveClass("opacity-100")
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      value: 0,
    })
    fireEvent.scroll(viewport)
    expect(shadow).toHaveClass("opacity-0")
  })

  it("uses stable priority groups and moves state changes to the front of their group", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-12T10:00:00Z"))
    const connectedAt = Date.now() - 10_000
    const idleA = {
      connectionId: "idle-a",
      state: "idle" as const,
      connectedAt,
    }
    const idleB = {
      connectionId: "idle-b",
      state: "idle" as const,
      connectedAt,
    }
    const connecting = {
      connectionId: "connecting-a",
      state: "connecting" as const,
      connectedAt,
    }
    const retiring = {
      connectionId: "retiring-a",
      state: "retiring" as const,
      connectedAt,
    }
    const active = {
      connectionId: "active-a",
      state: "transmitting" as const,
      connectedAt,
    }
    const { rerender } = render(
      <WebSocketActivityCard
        connections={[idleA, connecting, idleB, retiring, active]}
      />
    )
    const rowIds = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.getAttribute("data-connection-id"))

    expect(rowIds()).toEqual([
      "active-a",
      "connecting-a",
      "retiring-a",
      "idle-a",
      "idle-b",
    ])

    rerender(
      <WebSocketActivityCard
        connections={[
          idleA,
          connecting,
          { ...idleB, state: "transmitting", activeRequestId: "request-1" },
          retiring,
          active,
        ]}
      />
    )
    act(() => vi.advanceTimersByTime(0))
    expect(rowIds()).toEqual([
      "idle-b",
      "active-a",
      "connecting-a",
      "retiring-a",
      "idle-a",
    ])

    rerender(
      <WebSocketActivityCard
        connections={[
          active,
          retiring,
          { ...idleB, state: "transmitting", activeRequestId: "request-2" },
          connecting,
          idleA,
        ]}
      />
    )
    act(() => vi.advanceTimersByTime(0))
    expect(rowIds()).toEqual([
      "idle-b",
      "active-a",
      "connecting-a",
      "retiring-a",
      "idle-a",
    ])

    rerender(
      <WebSocketActivityCard
        connections={[
          active,
          retiring,
          { ...idleB, state: "retiring" },
          connecting,
          idleA,
        ]}
      />
    )
    act(() => vi.advanceTimersByTime(0))
    expect(rowIds()).toEqual([
      "active-a",
      "idle-b",
      "connecting-a",
      "retiring-a",
      "idle-a",
    ])

    rerender(
      <WebSocketActivityCard
        connections={[
          active,
          { ...idleB, state: "retiring" },
          connecting,
          idleA,
        ]}
      />
    )
    act(() => vi.advanceTimersByTime(0))
    expect(rowIds()).toEqual(["active-a", "idle-b", "connecting-a", "idle-a"])

    const newIdle = {
      connectionId: "idle-new",
      state: "idle" as const,
      connectedAt,
    }
    rerender(
      <WebSocketActivityCard
        connections={[
          active,
          { ...idleB, state: "retiring" },
          connecting,
          idleA,
          newIdle,
        ]}
      />
    )
    act(() => vi.advanceTimersByTime(0))
    expect(rowIds()).toEqual([
      "active-a",
      "idle-b",
      "connecting-a",
      "idle-new",
      "idle-a",
    ])
  })
})
