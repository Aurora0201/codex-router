import { afterEach, describe, expect, it, vi } from "vitest"
import { createHttpGatewayService } from "./gateway-service"

class EventSourceStub {
  static instance: EventSourceStub | null = null
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>()
  readonly url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()

  constructor(url: string) {
    this.url = url
    EventSourceStub.instance = this
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener as (event: MessageEvent<string>) => void)
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("Gateway SSE subscription", () => {
  it("reports connection state, parses invalidations, and closes cleanly", () => {
    vi.stubGlobal("EventSource", EventSourceStub)
    const invalidate = vi.fn()
    const connection = vi.fn()
    const unsubscribe = createHttpGatewayService().subscribe(
      invalidate,
      connection
    )
    const source = EventSourceStub.instance!

    expect(source.url).toBe("/api/events")
    source.onopen?.()
    source.listeners.get("invalidate")?.(
      new MessageEvent("invalidate", {
        data: JSON.stringify({
          resources: ["accounts", "stats", "websocketConnections"],
        }),
      })
    )
    source.onerror?.()

    expect(connection.mock.calls).toEqual([[true], [false]])
    expect(invalidate).toHaveBeenCalledWith([
      "accounts",
      "stats",
      "websocketConnections",
    ])
    unsubscribe()
    expect(source.close).toHaveBeenCalledOnce()
  })
})
