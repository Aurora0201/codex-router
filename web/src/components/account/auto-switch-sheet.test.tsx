import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { AutoSwitchButton } from "@/components/account/auto-switch-sheet"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import type {
  AutoSwitchSettingsView,
  AutoSwitchView,
  GatewayService,
} from "@/services/contracts"

type Fixture = GatewayService & {
  snapshot: ReturnType<typeof createGatewayServiceFixture>["snapshot"]
}

const SETTINGS: AutoSwitchSettingsView = {
  enabled: true,
  switchOn: "weekly",
  thresholdPercent: 25,
  shortThresholdPercent: 15,
  minDwellMs: 5 * 60_000,
  switchBackToHigherPriority: false,
  onAllBelow: "highest",
  triggerOn429: true,
  triggerOnAuthFailure: true,
}

/** Opens the sheet over a gateway whose auto-switch state is `view`. */
async function open(view?: Partial<AutoSwitchView>) {
  const service: Fixture = createGatewayServiceFixture()
  if (view) {
    vi.spyOn(service, "getAutoSwitch").mockResolvedValue({
      settings: SETTINGS,
      candidateIds: service.snapshot.accounts.accounts.map(
        (account) => account.id
      ),
      stalled: false,
      recent: [],
      ...view,
    })
  }
  render(
    <AutoSwitchButton routing={service.snapshot.accounts} service={service} />
  )
  await userEvent.click(screen.getByRole("button", { name: /自动切换/ }))
  return service
}

function rows() {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-slot=auto-switch-row]")
  )
}

/**
 * jsdom lays nothing out, so every row measures 0×0 at the origin. `rect` is
 * what the row would measure, and `pointerY` where the pointer is inside it.
 */
function hover(row: HTMLElement, pointerY: number, top: number, height = 40) {
  const event = new Event("dragover", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clientY", { value: pointerY })
  Object.defineProperty(row, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ top, height, bottom: top + height }) as DOMRect,
  })
  act(() => {
    row.dispatchEvent(event)
  })
}

/** Drag-and-drop is not something userEvent drives. */
function startDrag(row: HTMLElement) {
  act(() => {
    row.dispatchEvent(new Event("dragstart", { bubbles: true }))
  })
}

describe("AutoSwitchButton", () => {
  it("opens with the gateway's own ranking rather than the account order", async () => {
    await open({ candidateIds: ["account-3", "account-1"] })

    await waitFor(() => expect(rows()).toHaveLength(3))
    // account-2 is out of the rotation, so it sits last but is still listed:
    // an account is put back by dragging it, not by finding it elsewhere.
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("account-3@example.com"),
      expect.stringContaining("account-1@example.com"),
      expect.stringContaining("account-2@example.com"),
    ])
    expect(
      within(rows()[2]).getByRole("switch", { name: /参与自动切换/ })
    ).not.toBeChecked()
  })

  it("names the window the ranking is actually judged on", async () => {
    const service = await open({})
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(rows()[0]).toHaveTextContent("周额度")

    await userEvent.click(screen.getByRole("button", { name: "5 小时额度" }))
    // The row has to read back the number the decision uses, or the list is
    // ranked on one window and reported on another.
    expect(rows()[0]).toHaveTextContent("5 小时额度")
    expect(service).toBeTruthy()
  })

  it("says no more than the four things needed to rank an account", async () => {
    await open({})

    await waitFor(() => expect(rows()).toHaveLength(3))
    const first = rows()[0]
    expect(first).toHaveTextContent("account-1@example.com")
    expect(first).toHaveTextContent("Plus")
    expect(first).toHaveTextContent("周额度")
    // No auth badge, no reset countdown, no last-refreshed line.
    expect(first.querySelector("[data-slot=quota-meter]")).toBeNull()
    expect(first).not.toHaveTextContent("已就绪")
  })

  it("arms switching", async () => {
    const service = await open()
    const save = vi.spyOn(service, "saveAutoSwitch")

    await userEvent.click(
      await screen.findByRole("switch", { name: "额度不足时自动换账号" })
    )
    expect(save).toHaveBeenCalledWith({ enabled: true })
  })

  it("says on the button itself when there is nowhere left to switch", async () => {
    await open({ stalled: true })
    expect(
      await screen.findByText("轮换里的账号都低于阈值，暂时无处可切。")
    ).toBeInTheDocument()
    // The open sheet makes the page behind it inert, so the trigger is not
    // reachable by role — it is still the thing that has to say this.
    expect(
      document.querySelector("[data-slot=sheet-trigger]")
    ).toHaveTextContent("自动切换 · 已暂停")
  })

  it("keeps every other setting out of reach until switching is on", async () => {
    await open()

    // Base UI switches are spans, so being off-limits reads as aria-disabled.
    expect(
      await screen.findByRole("switch", { name: "上游返回 429" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByRole("switch", { name: "额度不足时自动换账号" })
    ).not.toHaveAttribute("aria-disabled", "true")
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(rows()[0]).not.toHaveAttribute("draggable", "true")
  })

  it("waits for the pointer to cross a row's middle before moving it", async () => {
    await open({})
    await waitFor(() => expect(rows()).toHaveLength(3))
    startDrag(rows()[0])

    // Into the top half of the third row, travelling down: not yet.
    hover(rows()[2], 90, 80)
    expect(rows()[0]).toHaveTextContent("account-1@example.com")

    // Past its middle: now.
    hover(rows()[2], 110, 80)
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("account-2@example.com"),
      expect.stringContaining("account-3@example.com"),
      expect.stringContaining("account-1@example.com"),
    ])
  })

  it("does not trade the same two rows back and forth under a still pointer", async () => {
    await open({})
    await waitFor(() => expect(rows()).toHaveLength(3))
    startDrag(rows()[0])

    // Past the middle of the second seat (40–80), so the two rows swap.
    hover(rows()[1], 70, 40)
    const settled = rows().map((row) => row.textContent)
    expect(settled[1]).toContain("account-1@example.com")

    // The dragged row now occupies that seat, so a pointer that has not moved
    // is over the row it is carrying. It must not swap anything back.
    for (let i = 0; i < 5; i += 1) hover(rows()[1], 70, 40)
    expect(rows().map((row) => row.textContent)).toEqual(settled)
  })

  it("writes the order once the row is dropped, not while it is moving", async () => {
    const service = await open({})
    const save = vi.spyOn(service, "saveAutoSwitchPriority")
    await waitFor(() => expect(rows()).toHaveLength(3))

    startDrag(rows()[0])
    hover(rows()[2], 110, 80)
    expect(save).not.toHaveBeenCalled()

    act(() => {
      rows()[2].dispatchEvent(new Event("drop", { bubbles: true }))
    })
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        order: ["account-2", "account-3", "account-1"],
      })
    )
  })

  it("drops an account out of the rotation without reordering the list", async () => {
    const service = await open({})
    const save = vi.spyOn(service, "saveAutoSwitchPriority")
    await waitFor(() => expect(rows()).toHaveLength(3))

    await userEvent.click(
      within(rows()[1]).getByRole("switch", { name: /参与自动切换/ })
    )
    expect(save).toHaveBeenCalledWith({
      order: ["account-1", "account-2", "account-3"],
      enrolled: { "account-1": true, "account-2": false, "account-3": true },
    })
  })

  it("explains a gateway that does not know the route, and retries", async () => {
    const service: Fixture = createGatewayServiceFixture()
    const read = vi
      .spyOn(service, "getAutoSwitch")
      .mockRejectedValue(new Error("Route GET:/api/auto-switch not found"))
    render(
      <AutoSwitchButton routing={service.snapshot.accounts} service={service} />
    )
    // The background read failed before anyone opened anything, and that is
    // not worth a toast.
    await waitFor(() => expect(read).toHaveBeenCalled())
    expect(document.querySelector("[data-slot=toast]")).toBeNull()

    await userEvent.click(screen.getByRole("button", { name: /自动切换/ }))
    expect(await screen.findByText("网关没有回应这个设置")).toBeInTheDocument()
    expect(
      screen.getByText("Route GET:/api/auto-switch not found")
    ).toBeInTheDocument()
    expect(rows()).toHaveLength(0)

    read.mockRestore()
    await userEvent.click(screen.getByRole("button", { name: "重试" }))
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(screen.queryByText("网关没有回应这个设置")).toBeNull()
  })

  it("picks its state back up on the next gateway tick after a failed read", async () => {
    const service: Fixture = createGatewayServiceFixture()
    const read = vi
      .spyOn(service, "getAutoSwitch")
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValue({
        settings: SETTINGS,
        candidateIds: service.snapshot.accounts.accounts.map(
          (account) => account.id
        ),
        stalled: false,
        recent: [],
      })
    const { rerender } = render(
      <AutoSwitchButton routing={service.snapshot.accounts} service={service} />
    )

    // The gateway was still coming up when the page mounted, so the button
    // knows nothing — and used to keep saying so until someone opened it.
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    expect(
      document.querySelector("[data-slot=sheet-trigger]")
    ).toHaveTextContent("自动切换")

    // The gateway's next snapshot is a new object, and that is the beat.
    rerender(
      <AutoSwitchButton
        routing={{ ...service.snapshot.accounts }}
        service={service}
      />
    )
    await waitFor(() =>
      expect(
        document.querySelector("[data-slot=sheet-trigger]")
      ).toHaveTextContent("自动切换 · 已开")
    )
  })

  it("drops the beat while the sheet is open, so a drag is not re-seated", async () => {
    const service: Fixture = createGatewayServiceFixture()
    const read = vi.spyOn(service, "getAutoSwitch")
    const { rerender } = render(
      <AutoSwitchButton routing={service.snapshot.accounts} service={service} />
    )
    await userEvent.click(screen.getByRole("button", { name: /自动切换/ }))
    await waitFor(() => expect(rows()).toHaveLength(3))
    const reads = read.mock.calls.length

    rerender(
      <AutoSwitchButton
        routing={{ ...service.snapshot.accounts }}
        service={service}
      />
    )
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(read).toHaveBeenCalledTimes(reads)
  })

  it("groups every setting under a named section, none left floating", async () => {
    await open({})
    await waitFor(() => expect(rows()).toHaveLength(3))
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>("[role=dialog] section")
    )
    expect(
      sections.map((section) => section.querySelector("h3")?.textContent)
    ).toEqual([
      "额度不足时自动换账号",
      "按哪个额度切换",
      "优先级",
      "触发与节奏",
      "切换记录",
    ])
    // Every control sits inside one of them: a row on the bare sheet reads as
    // unanchored next to five filled blocks.
    for (const control of document.querySelectorAll(
      "[role=dialog] [data-slot=switch], [role=dialog] [data-slot=slider]"
    )) {
      expect(control.closest("section")).not.toBeNull()
    }
  })

  it("shows only the threshold the chosen window actually uses", async () => {
    await open({})
    // The week is the default basis, so the 5-hour threshold is not standing
    // there asking to be set when nothing reads it.
    expect(await screen.findByRole("slider", { name: "周额度" })).toBeEnabled()
    expect(screen.getByText("低于 25%")).toBeInTheDocument()
    expect(screen.queryByRole("slider", { name: "5 小时额度" })).toBeNull()
  })

  it("switches the basis to the 5-hour window, and swaps the threshold with it", async () => {
    const service = await open({})
    const save = vi.spyOn(service, "saveAutoSwitch")

    await userEvent.click(
      await screen.findByRole("button", { name: "5 小时额度" })
    )
    expect(save).toHaveBeenCalledWith({ switchOn: "short" })
    expect(screen.getByRole("slider", { name: "5 小时额度" })).toBeEnabled()
    expect(screen.queryByRole("slider", { name: "周额度" })).toBeNull()
    expect(screen.getByText("低于 15%")).toBeInTheDocument()
  })

  it("puts both thresholds up when both windows decide", async () => {
    const service = await open({})
    await userEvent.click(
      await screen.findByRole("button", { name: "两个都看" })
    )
    expect(screen.getByRole("slider", { name: "周额度" })).toBeEnabled()
    expect(screen.getByRole("slider", { name: "5 小时额度" })).toBeEnabled()
    expect(service).toBeTruthy()
  })

  it("names the window that decided a switch, not just the reason code", async () => {
    await open({
      recent: [
        {
          id: "log-1",
          switchedAt: Date.now() - 60_000,
          fromAccountId: "account-1",
          toAccountId: "account-2",
          reason: "quota_below_threshold",
          evidence: { window: "short", thresholdPercent: 15 },
        },
      ],
    })
    expect(await screen.findByText("5 小时额度低于阈值")).toBeInTheDocument()
  })
})
