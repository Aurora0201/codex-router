import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { AccountView } from "@/services/contracts"
import { AccountList } from "./account-list"

function account(values: Partial<AccountView> = {}): AccountView {
  const authStatus = values.authStatus ?? values.auth?.status ?? "ready"
  return {
    id: "account-1",
    chatgptAccountId: "account-1234567890",
    email: "user@example.com",
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
    auth: { status: authStatus, mode: "chatgpt", checkedAt: Date.now(), lastSuccessfulAt: Date.now(), stale: false, errorCode: null },
    subscription: { expiresAt: null, source: null },
    limits: { buckets: [], defaultBucketKey: null, resetCredits: null, checkedAt: null },
    ...values,
  }
}
const renderList = (accounts: AccountView[], props: Partial<Parameters<typeof AccountList>[0]> = {}) => render(
  <TooltipProvider><AccountList accounts={accounts} busyId={null} onSelect={vi.fn()} onAction={vi.fn()} onConsumeReset={vi.fn(async () => undefined)} {...props} /></TooltipProvider>
)

describe("AccountList", () => {
  it("uses a responsive equal-height card grid and sorts active and attention accounts first", () => {
    const { container } = renderList([
      account({ id: "ready", email: "ready@example.com" }),
      account({ id: "disabled", email: "disabled@example.com", enabled: false, authStatus: "disabled", auth: { status: "disabled", mode: "chatgpt", checkedAt: null, lastSuccessfulAt: null, stale: false, errorCode: null } }),
      account({ id: "attention", email: "attention@example.com", authStatus: "error", auth: { status: "error", mode: "chatgpt", checkedAt: null, lastSuccessfulAt: null, stale: false, errorCode: "temporary" } }),
      account({ id: "active", email: "active@example.com", isActive: true }),
    ])
    const grid = container.querySelector(".md\\:grid-cols-2")
    expect(grid).toHaveClass("2xl:grid-cols-3", "items-stretch")
    const cards = Array.from(grid?.children ?? [])
    expect(cards[0]).toHaveTextContent("active@example.com")
    expect(cards[1]).toHaveTextContent("attention@example.com")
    expect(cards[0]).toHaveClass("h-full", "min-h-0")
    expect(screen.getByText("账号总数").parentElement).toHaveTextContent("4")
  })

  it("shows weekly before shorter dynamic windows", () => {
    renderList([account({ limits: {
      defaultBucketKey: "codex",
      checkedAt: Date.now(),
      resetCredits: null,
      buckets: [{
        key: "codex", limitId: null, limitName: "Codex", credits: null, individualLimit: null,
        spendControlReached: false, planType: "plus", rateLimitReachedType: null,
        primary: { usedPercent: 25, resetsAt: Date.now() + 1000, windowDurationMins: 300 },
        secondary: { usedPercent: 50, resetsAt: Date.now() + 1000, windowDurationMins: 10080 },
      }],
    } })])
    const weekly = screen.getByText("周额度")
    const fiveHour = screen.getByText("5 小时额度")
    expect(weekly.compareDocumentPosition(fiveHour)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it("searches and filters accounts", async () => {
    const user = userEvent.setup()
    renderList([
      account({ id: "ready", email: "ready@example.com" }),
      account({ id: "disabled", email: "disabled@example.com", enabled: false, authStatus: "disabled", auth: { status: "disabled", mode: null, checkedAt: null, lastSuccessfulAt: null, stale: false, errorCode: null } }),
    ])
    const search = screen.getByRole("textbox", { name: "搜索授权账号" })
    await user.type(search, "disabled")
    expect(screen.getByText("disabled@example.com")).toBeInTheDocument()
    expect(screen.queryByText("ready@example.com")).not.toBeInTheDocument()
    await user.clear(search)
    await user.click(screen.getByRole("combobox", { name: "筛选账号状态" }))
    await user.click(await screen.findByRole("option", { name: "已停用（1）" }))
    expect(screen.getByText("disabled@example.com")).toBeInTheDocument()
    expect(screen.queryByText("ready@example.com")).not.toBeInTheDocument()
  })

  it("opens the details sheet and confirms a reset credit with one idempotency key", async () => {
    const user = userEvent.setup()
    const onConsumeReset = vi.fn(async () => undefined)
    const value = account({ limits: {
      buckets: [], defaultBucketKey: null, checkedAt: Date.now(),
      resetCredits: { availableCount: 1, credits: [{ id: "credit-1", resetType: "weekly", status: "available", grantedAt: Date.now(), expiresAt: Date.now() + 1000, title: "Weekly reset", description: null }] },
    } })
    renderList([value], { onConsumeReset })
    await user.click(screen.getByRole("button", { name: "查看账号详情" }))
    const sheet = screen.getByRole("dialog")
    expect(within(sheet).getByText("全部额度窗口")).toBeInTheDocument()
    await user.click(within(sheet).getByRole("button", { name: "使用重置券" }))
    await user.click(screen.getByRole("button", { name: "确认使用" }))
    expect(onConsumeReset).toHaveBeenCalledWith(value, { idempotencyKey: expect.any(String), creditId: "credit-1" })
  })

  it("keeps legacy subscription estimates visible as pending", () => {
    renderList([account({ subscriptionExpiresAt: Date.UTC(2026, 7, 31), subscription: { expiresAt: Date.UTC(2026, 7, 31), source: "legacy_estimate" } })])
    expect(screen.getByText("待确认")).toBeInTheDocument()
    expect(screen.getByText("2026/08/31")).toBeInTheDocument()
  })

  it("only allows ready accounts to become the manual route", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const value = account({ id: "candidate" })
    renderList([value], { onSelect })
    await user.click(screen.getByRole("button", { name: "设为当前路由" }))
    expect(onSelect).toHaveBeenCalledWith(value)
  })
})
