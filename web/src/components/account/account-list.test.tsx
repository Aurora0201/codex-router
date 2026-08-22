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
  return { usedPercent, resetsAt: Date.now() + 3 * HOUR, windowDurationMins: mins }
}

function bucket(values: Partial<RateLimitBucketView> = {}): RateLimitBucketView {
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
  Array.from(document.querySelectorAll<HTMLLIElement>("ul > li"))

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
    expect(screen.getByText("尚未选择路由账号")).toBeInTheDocument()
    expect(
      screen.getByText("· 请求使用 Codex 当前登录账号透传")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "清除路由" })
    ).not.toBeInTheDocument()
  })

  it("marks the live row with a badge instead of a switch button", () => {
    renderList([
      account({ id: "live", isActive: true }),
      account({ id: "standby", chatgptAccountId: "acct-standby" }),
    ])

    const live = rows()[0]
    expect(live).toHaveClass("border-l-primary")
    expect(within(live).getByText("当前路由")).toBeInTheDocument()
    expect(
      within(live).queryByRole("button", { name: "切换到此" })
    ).not.toBeInTheDocument()
    expect(
      within(rows()[1]).getByRole("button", { name: "切换到此" })
    ).toBeInTheDocument()
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
    const weekly = within(row).getByRole("progressbar", { name: "周剩余额度" })
    const short = within(row).getByRole("progressbar", { name: "5 小时剩余额度" })
    expect(weekly.compareDocumentPosition(short)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  it("offers the next useful step instead of a dead switch button", async () => {
    const onAction = vi.fn()
    renderList(
      [
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

    await userEvent.click(screen.getByRole("button", { name: "刷新认证" }))
    expect(onAction.mock.calls[0][1]).toBe("auth")
    await userEvent.click(screen.getByRole("button", { name: "启用账号" }))
    expect(onAction.mock.calls[1][1]).toBe("toggle")
  })

  it("shows only the most urgent qualifier on the second line", () => {
    renderList([
      account({
        subscriptionExpiresAt: Date.now() - DAY,
        subscription: { expiresAt: Date.now() - DAY, source: "legacy_estimate" },
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

    expect(screen.getByText("订阅已过期")).toBeInTheDocument()
    expect(screen.queryByText("到期日待确认")).not.toBeInTheDocument()
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
