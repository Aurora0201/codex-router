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
  dryRun: true,
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
      recent: [],
      ...view,
    })
  }
  const accounts = service.snapshot.accounts.accounts
  render(
    <AutoSwitchButton
      accounts={accounts}
      activeAccountId={accounts[0].id}
      service={service}
    />
  )
  await userEvent.click(screen.getByRole("button", { name: /自动切换/ }))
  return service
}

function rows() {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-slot=auto-switch-row]")
  )
}

/** Drag-and-drop is not something userEvent drives; the events are dispatched
 *  one render apart so the component sees the drag it is being asked about. */
function drag(from: HTMLElement, over: HTMLElement) {
  act(() => {
    from.dispatchEvent(new Event("dragstart", { bubbles: true }))
  })
  act(() => {
    over.dispatchEvent(new Event("dragenter", { bubbles: true }))
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

  it("arms switching without taking it out of the trial run", async () => {
    const service = await open()
    const save = vi.spyOn(service, "saveAutoSwitch")

    await userEvent.click(
      await screen.findByRole("switch", { name: "额度不足时自动换账号" })
    )
    expect(save).toHaveBeenCalledWith({ enabled: true })
    expect(screen.getByRole("switch", { name: "先试运行" })).toBeChecked()
  })

  it("keeps every other setting out of reach until switching is on", async () => {
    await open()

    // Base UI switches are spans, so being off-limits reads as aria-disabled.
    expect(
      await screen.findByRole("switch", { name: "先试运行" })
    ).toHaveAttribute("aria-disabled", "true")
    expect(
      screen.getByRole("switch", { name: "额度不足时自动换账号" })
    ).not.toHaveAttribute("aria-disabled", "true")
    await waitFor(() => expect(rows()).toHaveLength(3))
    expect(rows()[0]).not.toHaveAttribute("draggable", "true")
  })

  it("writes the order once the row is dropped, not while it is moving", async () => {
    const service = await open({})
    const save = vi.spyOn(service, "saveAutoSwitchPriority")
    await waitFor(() => expect(rows()).toHaveLength(3))

    const [first, , third] = rows()
    drag(first, third)
    expect(save).not.toHaveBeenCalled()
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("account-2@example.com"),
      expect.stringContaining("account-3@example.com"),
      expect.stringContaining("account-1@example.com"),
    ])

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
    const accounts = service.snapshot.accounts.accounts
    render(
      <AutoSwitchButton
        accounts={accounts}
        activeAccountId={accounts[0].id}
        service={service}
      />
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

  it("groups every setting under a named section, none left floating", async () => {
    await open({})
    await waitFor(() => expect(rows()).toHaveLength(3))
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>("[role=dialog] section")
    )
    expect(
      sections.map((section) => section.querySelector("h3")?.textContent)
    ).toEqual([
      "运行方式",
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
          dryRun: false,
          evidence: { window: "short", thresholdPercent: 15 },
        },
      ],
    })
    expect(await screen.findByText("5 小时额度低于阈值")).toBeInTheDocument()
  })
})
