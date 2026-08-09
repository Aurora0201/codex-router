import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AccountTable } from "@/components/account/AccountTable"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { Account } from "@/services/contracts"

function makeAccount(index: number): Account {
  return {
    id: `account-${index}`,
    chatgptAccountId: `acct_01JQ7V5M0F6K${index}`,
    email: `account-${index}@example.com`,
    planType: "Plus",
    enabled: true,
    authStatus: "ready",
    rateLimitReachedType: null,
    usage: {
      primary: { usedPercent: 20, resetsAt: Date.now() + 3_600_000, windowDurationMins: 300 },
      secondary: { usedPercent: 40, resetsAt: Date.now() + 86_400_000, windowDurationMins: 10_080 },
    },
    lastAuthRefreshAt: Date.now(),
    lastLimitsRefreshAt: Date.now(),
  }
}

describe("AccountTable", () => {
  afterEach(() => vi.restoreAllMocks())

  it("keeps a stable desktop viewport and reports the account total", () => {
    const accounts = Array.from({ length: 6 }, (_, index) => makeAccount(index))
    const { container } = render(
      <TooltipProvider>
        <AccountTable accounts={accounts} activeAccountId={null} busy={null} onAction={() => undefined} />
      </TooltipProvider>,
    )

    expect(screen.getByText("共 6 个账号")).toBeInTheDocument()
    expect(container.querySelector('[data-slot="card"]')).toHaveClass("h-[30rem]")
    expect(container.querySelector('[data-slot="scroll-area"]')).toBeInTheDocument()
  })

  it("reveals a newly selected account by scrolling only the table viewport", () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const element = this as HTMLElement
      if (element.dataset.slot === "scroll-area-viewport") {
        return { top: 0, bottom: 200, left: 0, right: 800, width: 800, height: 200, x: 0, y: 0, toJSON: () => ({}) }
      }
      if (element.dataset.state === "selected") {
        return { top: 300, bottom: 376, left: 0, right: 800, width: 800, height: 76, x: 0, y: 300, toJSON: () => ({}) }
      }
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }
    })

    const accounts = Array.from({ length: 6 }, (_, index) => makeAccount(index))
    const { container, rerender } = render(
      <TooltipProvider>
        <AccountTable accounts={accounts} activeAccountId={null} busy={null} onAction={() => undefined} />
      </TooltipProvider>,
    )
    const viewport = container.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
    expect(viewport?.scrollTop).toBe(0)

    rerender(
      <TooltipProvider>
        <AccountTable accounts={accounts} activeAccountId="account-5" busy={null} onAction={() => undefined} />
      </TooltipProvider>,
    )

    expect(viewport?.scrollTop).toBe(176)
    expect(document.documentElement.scrollTop).toBe(0)
  })
})
