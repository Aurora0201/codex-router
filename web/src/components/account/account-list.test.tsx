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
    billing: { anchorAt: null, cadence: null },
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

const cards = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-slot=account-card]"))

const card = (id: string) =>
  cards().find((item) => item.textContent?.includes(id))!

const meters = (item: HTMLElement) =>
  Array.from(item.querySelectorAll("[data-slot=quota-meter]"))

describe("AccountList", () => {
  it("names the live route in the summary and offers to clear it", async () => {
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

    const summary = screen
      .getByText("当前请求路由")
      .closest("div")!.parentElement!
    expect(summary).toHaveTextContent("acct-live")
    expect(within(summary).getByText("acct-live")).not.toHaveClass("font-mono")
    expect(within(card("acct-live")).getByText("acct-live")).not.toHaveClass(
      "font-mono"
    )
    expect(screen.getByText("紧要额度").nextElementSibling).toHaveTextContent(
      "38%"
    )
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

    await userEvent.click(
      screen.getByRole("radio", { name: "路由到 acct-standby" })
    )
    expect(onSelect).toHaveBeenCalledWith(standby)
  })

  it("locks the radio on every account that cannot be routed", () => {
    renderList([
      account({ id: "ready", chatgptAccountId: "acct-ready" }),
      account({
        id: "off",
        chatgptAccountId: "acct-off",
        enabled: false,
        authStatus: "disabled",
      }),
      account({
        id: "limited",
        chatgptAccountId: "acct-limited",
        authStatus: "rate_limited",
      }),
    ])

    for (const id of ["acct-off", "acct-limited"]) {
      expect(
        screen.getByRole("radio", { name: `路由到 ${id}` })
      ).toHaveAttribute("aria-disabled", "true")
    }
    expect(
      screen.getByRole("radio", { name: "路由到 acct-ready" })
    ).not.toHaveAttribute("aria-disabled", "true")
  })

  it("keeps the order the server gave, whatever the accounts are doing", () => {
    const pool = [
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
      account({
        id: "off",
        chatgptAccountId: "acct-off",
        enabled: false,
        authStatus: "disabled",
      }),
    ]
    const expected = [
      expect.stringContaining("acct-tight"),
      expect.stringContaining("acct-broken"),
      expect.stringContaining("acct-roomy"),
      expect.stringContaining("acct-off"),
    ]
    const { rerender } = renderList(pool)
    expect(cards().map((item) => item.textContent)).toEqual(expected)

    // Spending quota and losing auth must not move anybody.
    rerender(
      <TooltipProvider>
        <AccountList
          accounts={[
            {
              ...pool[0],
              limits: quota([bucket({ primary: window(5, 300) })]),
            },
            { ...pool[1], isActive: true },
            {
              ...pool[2],
              limits: quota([bucket({ primary: window(99, 300) })]),
            },
            pool[3],
          ]}
          busyId={null}
          onSelect={vi.fn()}
          onClearRoute={vi.fn()}
          onAction={vi.fn()}
          onConsumeReset={vi.fn(async () => undefined)}
        />
      </TooltipProvider>
    )
    expect(cards().map((item) => item.textContent)).toEqual(expected)
  })

  it("gives every card both windows, the brand mark and a renewal footer", () => {
    renderList([
      account({
        billing: { anchorAt: Date.UTC(2026, 7, 15), cadence: "monthly" },
        limits: quota([
          bucket({ primary: window(25, 300), secondary: window(50, 10080) }),
        ]),
      }),
      account({ id: "none", chatgptAccountId: "acct-none" }),
    ])

    for (const item of cards()) {
      expect(meters(item)).toHaveLength(2)
      expect(item.querySelectorAll("[data-slot=metric-mark]")).toHaveLength(1)
    }
    expect(screen.getByText(/^\d{4}\/\d{2}\/\d{2} 自动续订 ·/)).toBeInTheDocument()
    expect(screen.getByText("未设置自动续订时间")).toBeInTheDocument()

    // Both slots stay named even with nothing to report, and never claim 无限制.
    const none = card("acct-none")
    expect(within(none).getByText("7 天额度")).toBeInTheDocument()
    expect(within(none).getByText("5 小时额度")).toBeInTheDocument()
    expect(within(none).getAllByText("额度尚未刷新")).toHaveLength(1)
    expect(within(none).queryByText("无限制")).not.toBeInTheDocument()
  })

  it("keeps missing billing metadata out of the attention state", () => {
    renderList([
      account(),
    ])
    expect(screen.getByRole("tab", { name: "需处理（0）" })).toBeInTheDocument()
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

    // The uncapped slot is the one upstream left out, not simply the last one.
    expect(meters(card("acct-no-short"))[1]).toHaveTextContent("无限制")
    expect(meters(card("acct-no-long"))[0]).toHaveTextContent("无限制")
  })

  it("offers a repair only where a card stays broken until someone acts", async () => {
    const onAction = vi.fn()
    renderList(
      [
        account({ id: "ready", chatgptAccountId: "acct-ready" }),
        account({
          id: "broken",
          chatgptAccountId: "acct-broken",
          authStatus: "error",
        }),
        // Disabling is a deliberate act, not a fault to repair.
        account({
          id: "off",
          chatgptAccountId: "acct-off",
          enabled: false,
          authStatus: "disabled",
        }),
        // Transient and self-clearing states resolve without a button.
        account({
          id: "busy",
          chatgptAccountId: "acct-busy",
          authStatus: "checking",
        }),
      ],
      { onAction }
    )

    for (const id of ["acct-ready", "acct-off", "acct-busy"]) {
      expect(
        within(card(id)).queryByRole("button", { name: "刷新认证" })
      ).not.toBeInTheDocument()
    }
    await userEvent.click(
      within(card("acct-broken")).getByRole("button", { name: "刷新认证" })
    )
    expect(onAction.mock.calls[0][1]).toBe("auth")
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

    const search = screen.getByRole("searchbox", { name: "搜索授权账号" })
    await user.type(search, "acct-off")
    expect(cards()).toHaveLength(1)
    await user.clear(search)

    const filters = screen.getByRole("tablist", { name: "账号状态筛选" })
    expect(filters.closest('[data-slot="animate-tabs"]')).not.toBeNull()
    await user.click(within(filters).getByRole("tab", { name: "已停用（1）" }))
    expect(cards()).toHaveLength(1)
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
    for (const title of ["账号信息", "全部额度窗口", "额度重置券"]) {
      expect(within(sheet).getByText(title)).toHaveClass(
        "font-heading",
        "font-medium"
      )
    }
    expect(within(sheet).getByText("订阅等级：").parentElement).toHaveClass(
      "min-h-8",
      "py-0.5"
    )
    expect(within(sheet).getByText("全部额度窗口")).toBeInTheDocument()
    await user.click(within(sheet).getByRole("button", { name: "使用重置券" }))
    await user.click(screen.getByRole("button", { name: "确认使用" }))
    expect(onConsumeReset).toHaveBeenCalledWith(value, {
      idempotencyKey: expect.any(String),
      creditId: "credit-1",
    })
  })
})
