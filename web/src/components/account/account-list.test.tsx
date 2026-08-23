import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type {
  AccountView,
  RateLimitBucketView,
  UsageWindowView,
} from "@/services/contracts"
import { AccountList } from "./account-list"

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function window(usedPercent: number | null, mins: number): UsageWindowView {
  return {
    usedPercent,
    resetsAt: Date.now() + 3 * HOUR,
    windowDurationMins: mins,
  }
}

function bucket(
  values: Partial<RateLimitBucketView> = {}
): RateLimitBucketView {
  return {
    key: "codex",
    limitId: null,
    limitName: "Codex",
    primary: null,
    secondary: null,
    credits: null,
    individualLimit: null,
    spendControlReached: false,
    planType: "plus",
    rateLimitReachedType: null,
    ...values,
  }
}

function quota(buckets: RateLimitBucketView[]): AccountView["limits"] {
  return {
    buckets,
    defaultBucketKey: "codex",
    resetCredits: null,
    checkedAt: Date.now(),
  }
}

function account(values: Partial<AccountView> = {}): AccountView {
  const authStatus = values.authStatus ?? values.auth?.status ?? "ready"
  return {
    id: "acct-1",
    chatgptAccountId: "acct-alpha",
    email: "alpha@example.com",
    planType: "Plus",
    subscriptionStartedAt: null,
    subscriptionExpiresAt: null,
    enabled: true,
    isActive: false,
    authStatus,
    rateLimitReachedType: null,
    usage: { primary: null, secondary: null },
    lastAuthRefreshAt: null,
    lastLimitsRefreshAt: null,
    auth: {
      status: authStatus,
      mode: "chatgpt",
      checkedAt: Date.now(),
      lastSuccessfulAt: Date.now(),
      stale: false,
      errorCode: null,
    },
    subscription: { expiresAt: null, source: null },
    limits: {
      buckets: [],
      defaultBucketKey: null,
      resetCredits: null,
      checkedAt: null,
    },
    ...values,
  }
}

const renderList = (
  accounts: AccountView[],
  props: Partial<Parameters<typeof AccountList>[0]> = {}
) =>
  render(
    <TooltipProvider>
      <AccountList
        accounts={accounts}
        busyId={null}
        onSelect={vi.fn()}
        onClearRoute={vi.fn()}
        onAction={vi.fn()}
        onConsumeReset={vi.fn(async () => undefined)}
        {...props}
      />
    </TooltipProvider>
  )

const rows = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-slot=account-row]"))

describe("AccountList", () => {
  it("names the live route in the header and offers to clear it", async () => {
    const onClearRoute = vi.fn()
    renderList(
      [
        account({
          id: "live",
          chatgptAccountId: "acct-live",
          isActive: true,
          limits: quota([bucket({ primary: window(62, 300) })]),
        }),
      ],
      { onClearRoute }
    )

    const header = screen.getByText("请求经由").parentElement
    expect(header).toHaveTextContent("acct-live")
    expect(header).toHaveTextContent("最紧额度剩余 38%")
    await userEvent.click(screen.getByRole("button", { name: "清除路由" }))
    expect(onClearRoute).toHaveBeenCalled()
  })

  it("explains passthrough when no account is routed", () => {
    renderList([account()])
    expect(
      screen.getByText("尚未选择路由账号 · 请求使用 Codex 当前登录账号透传")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "清除路由" })
    ).not.toBeInTheDocument()
  })

  it("keeps the route summary the same height with and without a route", () => {
    const routed = renderList([account({ id: "live", isActive: true })])
    const withRoute = screen
      .getByText("请求经由")
      .closest("div")!.parentElement!
    expect(withRoute).toHaveClass("min-h-13")
    routed.unmount()

    renderList([account()])
    const withoutRoute = screen.getByText(
      "尚未选择路由账号 · 请求使用 Codex 当前登录账号透传"
    ).parentElement!
    expect(withoutRoute).toHaveClass("min-h-13")
  })

  it("indents the row dividers away from the card edge", () => {
    renderList([account({ id: "one" }), account({ id: "two" })])
    for (const row of rows()) {
      expect(row).toHaveClass("after:inset-x-4", "last:after:hidden")
    }
  })

  it("routes through a single radio group with exactly one account checked", async () => {
    const onSelect = vi.fn()
    const standby = account({ id: "standby", chatgptAccountId: "acct-standby" })
    renderList([account({ id: "live", isActive: true }), standby], { onSelect })

    const group = screen.getByRole("radiogroup", { name: "选择路由账号" })
    const radios = within(group).getAllByRole("radio")
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
    ])
    expect(
      within(group).queryByRole("button", { name: /切换/ })
    ).not.toBeInTheDocument()

    await userEvent.click(
      screen.getByRole("radio", { name: "路由到 acct-standby" })
    )
    expect(onSelect).toHaveBeenCalledWith(standby)
  })

  it("disables the radio on accounts that cannot be routed", () => {
    renderList([
      account({ id: "ready" }),
      account({
        id: "broken",
        chatgptAccountId: "acct-broken",
        authStatus: "relogin_required",
      }),
    ])

    const broken = screen.getByRole("radio", { name: "路由到 acct-broken" })
    expect(broken).toHaveAttribute("aria-disabled", "true")
    expect(broken).toHaveClass("data-disabled:opacity-40")
    expect(
      screen.getByRole("radio", { name: "路由到 acct-alpha" })
    ).not.toHaveAttribute("aria-disabled", "true")
  })

  it("keeps row order stable when the route changes", async () => {
    const { rerender } = renderList([
      account({
        id: "a",
        chatgptAccountId: "acct-a",
        limits: quota([bucket({ primary: window(10, 300) })]),
      }),
      account({
        id: "b",
        chatgptAccountId: "acct-b",
        limits: quota([bucket({ primary: window(80, 300) })]),
      }),
    ])
    const before = rows().map((row) => row.textContent)

    rerender(
      <TooltipProvider>
        <AccountList
          accounts={[
            account({
              id: "a",
              chatgptAccountId: "acct-a",
              limits: quota([bucket({ primary: window(10, 300) })]),
            }),
            account({
              id: "b",
              chatgptAccountId: "acct-b",
              isActive: true,
              limits: quota([bucket({ primary: window(80, 300) })]),
            }),
          ]}
          busyId={null}
          onSelect={vi.fn()}
          onClearRoute={vi.fn()}
          onAction={vi.fn()}
          onConsumeReset={vi.fn(async () => undefined)}
        />
      </TooltipProvider>
    )

    expect(rows().map((row) => row.textContent)).toEqual(before)
    await Promise.resolve()
  })

  it("puts the roomiest routable account first and sinks broken ones", () => {
    renderList([
      account({
        id: "tight",
        chatgptAccountId: "acct-tight",
        limits: quota([bucket({ primary: window(90, 300) })]),
      }),
      account({
        id: "broken",
        chatgptAccountId: "acct-broken",
        authStatus: "relogin_required",
      }),
      account({
        id: "roomy",
        chatgptAccountId: "acct-roomy",
        limits: quota([bucket({ primary: window(10, 300) })]),
      }),
    ])

    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining("acct-roomy"),
      expect.stringContaining("acct-tight"),
      expect.stringContaining("acct-broken"),
    ])
  })

  it("stacks the account id above the email and the weekly window above the short one", () => {
    renderList([
      account({
        limits: quota([
          bucket({ primary: window(25, 300), secondary: window(50, 10080) }),
        ]),
      }),
    ])

    const row = rows()[0]
    const id = within(row).getByText("acct-alpha")
    const email = within(row).getByText("alpha@example.com")
    expect(id.compareDocumentPosition(email)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    const weekly = within(row).getByRole("progressbar", {
      name: "7 天额度剩余",
    })
    const short = within(row).getByRole("progressbar", {
      name: "5 小时额度剩余",
    })
    expect(weekly.compareDocumentPosition(short)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  it("offers a repair on rows that cannot be routed and nothing on rows that can", async () => {
    const onAction = vi.fn()
    renderList(
      [
        account({ id: "ready", chatgptAccountId: "acct-ready" }),
        account({ id: "broken", authStatus: "error" }),
        account({
          id: "off",
          chatgptAccountId: "acct-off",
          enabled: false,
          authStatus: "disabled",
        }),
      ],
      { onAction }
    )

    const readyRow = rows().find((row) =>
      row.textContent?.includes("acct-ready")
    )!
    expect(within(readyRow).queryAllByRole("button")).toHaveLength(2) // id + ⋯

    await userEvent.click(screen.getByRole("button", { name: "刷新认证" }))
    expect(onAction.mock.calls[0][1]).toBe("auth")
    await userEvent.click(screen.getByRole("button", { name: "启用账号" }))
    expect(onAction.mock.calls[1][1]).toBe("toggle")
  })

  it("keeps two quota slots on every row and brands each with the OpenAI mark", () => {
    renderList([
      account({
        id: "both",
        limits: quota([
          bucket({ primary: window(25, 300), secondary: window(50, 10080) }),
        ]),
      }),
      // Only the short window reported: the weekly slot still holds its place.
      account({
        id: "partial",
        chatgptAccountId: "acct-partial",
        limits: quota([
          bucket({ primary: window(40, 300), secondary: window(null, 10080) }),
        ]),
      }),
      account({ id: "none", chatgptAccountId: "acct-none" }),
    ])

    for (const row of rows()) {
      expect(row.querySelectorAll("[data-slot=quota-meter]")).toHaveLength(2)
      expect(row.querySelectorAll("[data-slot=metric-mark]")).toHaveLength(1)
    }

    const partial = rows().find((row) =>
      row.textContent?.includes("acct-partial")
    )!
    expect(within(partial).getByText("7 天额度")).toBeInTheDocument()
    expect(within(partial).getByText("未报告")).toBeInTheDocument()

    // A row with no limit data at all says so once, and never claims 无限制.
    const none = rows().find((row) => row.textContent?.includes("acct-none"))!
    expect(within(none).getAllByText("额度尚未刷新")).toHaveLength(1)
    expect(within(none).queryByText("无限制")).not.toBeInTheDocument()
    // Both slots stay named even with nothing to report.
    expect(within(none).getByText("7 天额度")).toBeInTheDocument()
    expect(within(none).getByText("5 小时额度")).toBeInTheDocument()
  })

  it("names the missing window by its role, whichever one upstream omitted", () => {
    renderList([
      account({
        id: "no-short",
        chatgptAccountId: "acct-no-short",
        limits: quota([bucket({ secondary: window(12, 10080) })]),
      }),
      account({
        id: "no-long",
        chatgptAccountId: "acct-no-long",
        limits: quota([bucket({ primary: window(30, 300) })]),
      }),
    ])

    const noShort = rows().find((r) =>
      r.textContent?.includes("acct-no-short")
    )!
    const noLong = rows().find((r) => r.textContent?.includes("acct-no-long"))!
    for (const row of [noShort, noLong]) {
      expect(within(row).getByText("7 天额度")).toBeInTheDocument()
      expect(within(row).getByText("5 小时额度")).toBeInTheDocument()
      expect(within(row).getByText("无限制")).toBeInTheDocument()
    }
    // The unlimited slot is the one upstream left out, not simply the last one.
    const slots = (row: HTMLElement) =>
      Array.from(row.querySelectorAll("[data-slot=quota-meter]"))
    expect(slots(noShort)[1]).toHaveTextContent("无限制")
    expect(slots(noLong)[0]).toHaveTextContent("无限制")
  })

  it("spends the accent colour only on the account traffic runs through", () => {
    renderList([
      account({
        id: "live",
        isActive: true,
        limits: quota([bucket({ primary: window(20, 300) })]),
      }),
      account({
        id: "standby",
        chatgptAccountId: "acct-standby",
        limits: quota([bucket({ primary: window(20, 300) })]),
      }),
    ])

    const live = rows().find((r) => r.textContent?.includes("acct-alpha"))!
    const standby = rows().find((r) => r.textContent?.includes("acct-standby"))!
    expect(live.querySelector("[role=progressbar]")).toHaveClass(
      "[&_[data-slot=progress-indicator]]:bg-primary"
    )
    expect(standby.querySelector("[role=progressbar]")).toHaveClass(
      "[&_[data-slot=progress-indicator]]:bg-foreground/25"
    )
  })

  it("puts every column on the same two baselines", () => {
    renderList([account()])
    const grid = rows()[0].lastElementChild!
    expect(grid).toHaveClass("grid-rows-[1.5rem_1.5rem]")
    for (const column of Array.from(grid.children).slice(0, 3)) {
      expect(column).toHaveClass("row-span-2", "grid-rows-subgrid")
    }
  })

  it("shows only the most urgent qualifier on the second line", () => {
    renderList([
      account({
        subscriptionExpiresAt: Date.now() - DAY,
        subscription: {
          expiresAt: Date.now() - DAY,
          source: "legacy_estimate",
        },
        auth: {
          status: "ready",
          mode: "chatgpt",
          checkedAt: Date.now(),
          lastSuccessfulAt: Date.now(),
          stale: true,
          errorCode: null,
        },
      }),
    ])

    expect(screen.getByText(/^已于 .+ 到期$/)).toBeInTheDocument()
    expect(screen.queryByText(/待确认/)).not.toBeInTheDocument()
    expect(screen.queryByText("认证数据已陈旧")).not.toBeInTheDocument()
  })

  it("searches and filters with counted state toggles", async () => {
    const user = userEvent.setup()
    renderList([
      account({ id: "ready", chatgptAccountId: "acct-ready" }),
      account({
        id: "off",
        chatgptAccountId: "acct-off",
        email: "off@example.com",
        enabled: false,
        authStatus: "disabled",
      }),
    ])

    const search = screen.getByRole("textbox", { name: "搜索授权账号" })
    await user.type(search, "acct-off")
    expect(rows()).toHaveLength(1)
    await user.clear(search)

    await user.click(screen.getByRole("button", { name: "已停用（1）" }))
    expect(rows()).toHaveLength(1)
    expect(screen.getByText("acct-off")).toBeInTheDocument()
    expect(screen.queryByText("acct-ready")).not.toBeInTheDocument()
  })

  it("opens the detail sheet from the account id and spends a reset credit once", async () => {
    const user = userEvent.setup()
    const onConsumeReset = vi.fn(async () => undefined)
    const value = account({
      limits: {
        buckets: [bucket({ primary: window(20, 300) })],
        defaultBucketKey: "codex",
        checkedAt: Date.now(),
        resetCredits: {
          availableCount: 1,
          credits: [
            {
              id: "credit-1",
              resetType: "weekly",
              status: "available",
              grantedAt: Date.now(),
              expiresAt: Date.UTC(2026, 7, 31),
              title: "Weekly reset",
              description: null,
            },
          ],
        },
      },
    })
    renderList([value], { onConsumeReset })

    await user.click(screen.getByRole("button", { name: /acct-alpha/ }))
    const sheet = screen.getByRole("dialog")
    expect(within(sheet).getByText("全部额度窗口")).toBeInTheDocument()
    expect(within(sheet).getByText("Plus")).toBeInTheDocument()
    await user.click(within(sheet).getByRole("button", { name: "使用重置券" }))
    await user.click(screen.getByRole("button", { name: "确认使用" }))
    expect(onConsumeReset).toHaveBeenCalledWith(value, {
      idempotencyKey: expect.any(String),
      creditId: "credit-1",
    })
  })
})
