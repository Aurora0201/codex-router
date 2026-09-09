import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { WarmupButton } from "@/components/account/warmup-sheet"
import { createGatewayServiceFixture } from "@/test/gateway-service-fixture"
import type { GatewayService, WarmupView } from "@/services/contracts"

type Fixture = GatewayService & {
  snapshot: ReturnType<typeof createGatewayServiceFixture>["snapshot"]
}

const HOUR = 3_600_000

/** A gateway whose warm-up state is `view`, rendered. */
function mount(view?: Partial<WarmupView>) {
  const service: Fixture = createGatewayServiceFixture()
  const accounts = service.snapshot.accounts.accounts
  if (view) {
    vi.spyOn(service, "getWarmup").mockResolvedValue({
      settings: {
        auto: false,
        model: null,
        message: "回复 OK 即可，不要解释。",
        cooldownMs: 15 * 60_000,
        dailyLimit: 6,
      },
      progress: { running: false, total: 0, done: 0, accountId: null },
      accounts: accounts.map((account) => ({
        id: account.id,
        enrolled: true,
        eligible: true,
        windowResetsAt: null,
        windowRunning: false,
      })),
      recent: [],
      ...view,
    })
  }
  render(
    <WarmupButton routing={service.snapshot.accounts} service={service} />
  )
  return service
}

function runButton() {
  return screen.getByRole("button", { name: "预热账号" })
}

function rows() {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-slot=warmup-row]")
  )
}

describe("WarmupButton", () => {
  it("says how many accounts it is about to spend on, before it spends", async () => {
    mount({})
    // The left half costs quota the moment it is clicked, so it never says
    // anything vaguer than the number it is about to spend on.
    await waitFor(() => expect(runButton()).toHaveTextContent("预热 3 个账号"))
    expect(runButton()).toBeEnabled()
  })

  it("counts only the accounts whose window is not already running", async () => {
    const service: Fixture = createGatewayServiceFixture()
    const accounts = service.snapshot.accounts.accounts
    vi.spyOn(service, "getWarmup").mockResolvedValue({
      settings: {
        auto: false,
        model: null,
        message: "hi",
        cooldownMs: 15 * 60_000,
        dailyLimit: 6,
      },
      progress: { running: false, total: 0, done: 0, accountId: null },
      accounts: accounts.map((account, index) => ({
        id: account.id,
        enrolled: index !== 2,
        eligible: true,
        windowResetsAt: index === 0 ? Date.now() + HOUR : null,
        windowRunning: index === 0,
      })),
      recent: [],
    })
    render(
      <WarmupButton routing={service.snapshot.accounts} service={service} />
    )
    // One is already counting and one opted out, so only one is left.
    await waitFor(() => expect(runButton()).toHaveTextContent("预热 1 个账号"))
  })

  it("goes quiet rather than offering to spend on nothing", async () => {
    const service: Fixture = createGatewayServiceFixture()
    const accounts = service.snapshot.accounts.accounts
    vi.spyOn(service, "getWarmup").mockResolvedValue({
      settings: {
        auto: false,
        model: null,
        message: "hi",
        cooldownMs: 15 * 60_000,
        dailyLimit: 6,
      },
      progress: { running: false, total: 0, done: 0, accountId: null },
      accounts: accounts.map((account) => ({
        id: account.id,
        enrolled: true,
        eligible: true,
        windowResetsAt: Date.now() + HOUR,
        windowRunning: true,
      })),
      recent: [],
    })
    render(
      <WarmupButton routing={service.snapshot.accounts} service={service} />
    )
    await waitFor(() => expect(runButton()).toHaveTextContent("无需预热"))
    expect(runButton()).toBeDisabled()
  })

  it("shows where a run has got to instead of a spinner", async () => {
    mount({
      progress: { running: true, total: 3, done: 1, accountId: "account-2" },
    })
    await waitFor(() => expect(runButton()).toHaveTextContent("预热中 1/3"))
    expect(runButton()).toBeDisabled()
  })

  it("starts a run without forcing when the left half is clicked", async () => {
    const service = mount({})
    const run = vi.spyOn(service, "runWarmup")
    await waitFor(() => expect(runButton()).toBeEnabled())
    await userEvent.click(runButton())
    expect(run).toHaveBeenCalledWith({})
  })

  it("groups the sheet under the four things it has to answer", async () => {
    mount({})
    await userEvent.click(screen.getByRole("button", { name: "预热设置" }))
    await waitFor(() => expect(rows()).toHaveLength(3))
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>("[role=dialog] section")
    )
    expect(
      sections.map((section) => section.querySelector("h3")?.textContent)
    ).toEqual(["窗口重置后自动预热", "发送什么", "参与预热的账号", "预热记录"])
  })

  it("arms the automatic pass, which is off until it is turned on", async () => {
    const service = mount({})
    const save = vi.spyOn(service, "saveWarmup")
    await userEvent.click(screen.getByRole("button", { name: "预热设置" }))
    const auto = await screen.findByRole("switch", {
      name: "窗口重置后自动预热",
    })
    expect(auto).not.toBeChecked()
    await userEvent.click(auto)
    expect(save).toHaveBeenCalledWith({ auto: true })
  })

  it("takes an account out of the rotation", async () => {
    const service = mount({})
    const save = vi.spyOn(service, "saveWarmupEnrollment")
    await userEvent.click(screen.getByRole("button", { name: "预热设置" }))
    await waitFor(() => expect(rows()).toHaveLength(3))

    await userEvent.click(
      within(rows()[1]).getByRole("switch", { name: /参与预热/ })
    )
    expect(save).toHaveBeenCalledWith({ enrolled: { "account-2": false } })
  })

  it("says whether the window actually started, not just that a turn ran", async () => {
    const started = Date.now() + 4 * HOUR
    mount({
      recent: [
        {
          id: "log-1",
          startedAt: Date.now() - 60_000,
          accountId: "account-1",
          trigger: "auto",
          outcome: "warmed",
          model: "gpt-fixture-default",
          durationMs: 6400,
          errorCode: null,
          windowBeforeResetsAt: null,
          windowAfterResetsAt: started,
        },
        {
          id: "log-2",
          startedAt: Date.now() - 120_000,
          accountId: "account-2",
          trigger: "manual",
          outcome: "failed",
          model: null,
          durationMs: 2100,
          errorCode: "rate_limited",
          windowBeforeResetsAt: null,
          windowAfterResetsAt: null,
        },
      ],
    })
    await userEvent.click(screen.getByRole("button", { name: "预热设置" }))
    // "The turn succeeded" is not the question anyone has.
    expect(await screen.findByText(/窗口已开始/)).toBeInTheDocument()
    expect(screen.getByText("上游限流")).toBeInTheDocument()
  })

  it("offers each account's own default rather than insisting on a model", async () => {
    mount({})
    await userEvent.click(screen.getByRole("button", { name: "预热设置" }))
    // Not every subscription has every model, so the safe pick is the default.
    expect(
      await screen.findByRole("combobox", { name: "使用模型" })
    ).toHaveTextContent("跟随账号默认")
  })

  it("explains the gateway that does not know the route, and retries", async () => {
    const service: Fixture = createGatewayServiceFixture()
    const read = vi
      .spyOn(service, "getWarmup")
      .mockRejectedValue(new Error("Route GET:/api/warmup not found"))
    render(
      <WarmupButton routing={service.snapshot.accounts} service={service} />
    )
    await waitFor(() => expect(read).toHaveBeenCalled())
    // A background read that failed before anyone opened anything is not worth
    // a toast.
    expect(document.querySelector("[data-slot=toast]")).toBeNull()

    await userEvent.click(screen.getByRole("button", { name: "预热设置" }))
    expect(await screen.findByText("网关没有回应这个设置")).toBeInTheDocument()

    read.mockRestore()
    await userEvent.click(screen.getByRole("button", { name: "重试" }))
    await waitFor(() => expect(rows()).toHaveLength(3))
  })
})
