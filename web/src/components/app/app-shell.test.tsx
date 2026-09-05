import type { CSSProperties } from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { AccountView, UsageWindowView } from "@/services/contracts"
import { AppHeader } from "./app-header"
import { AppSidebar } from "./app-sidebar"

function ShellProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <SidebarProvider
          style={{ "--sidebar-width-icon": "3.5rem" } as CSSProperties}
        >
          {children}
        </SidebarProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}

function quotaWindow(
  usedPercent: number,
  windowDurationMins: number
): UsageWindowView {
  return { usedPercent, resetsAt: Date.now() + 60_000, windowDurationMins }
}

function activeAccount(
  shortWindow: UsageWindowView | null,
  longWindow: UsageWindowView | null
): AccountView {
  return {
    id: "acct-1",
    chatgptAccountId: "acct-alpha",
    email: "alpha@example.com",
    planType: "Plus",
    enabled: true,
    isActive: true,
    authStatus: "ready",
    rateLimitReachedType: null,
    usage: { primary: shortWindow, secondary: longWindow },
    lastAuthRefreshAt: null,
    lastLimitsRefreshAt: null,
    auth: {
      status: "ready",
      mode: "chatgpt",
      checkedAt: Date.now(),
      lastSuccessfulAt: Date.now(),
      stale: false,
      errorCode: null,
    },
    billing: { anchorAt: null, cadence: null },
    limits: {
      buckets: [
        {
          key: "codex",
          limitId: null,
          limitName: "Codex",
          primary: shortWindow,
          secondary: longWindow,
          credits: null,
          individualLimit: null,
          spendControlReached: false,
          planType: "plus",
          rateLimitReachedType: null,
        },
      ],
      defaultBucketKey: "codex",
      resetCredits: null,
      checkedAt: Date.now(),
    },
  }
}

describe("application shell", () => {
  it("collapses to the branded expand control without a resize rail", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ShellProviders>
        <AppSidebar page="accounts" onPageChange={vi.fn()} />
      </ShellProviders>
    )

    const sidebarWrapper = container.querySelector(
      '[data-slot="sidebar-wrapper"]'
    ) as HTMLElement
    expect(sidebarWrapper.style.getPropertyValue("--sidebar-width-icon")).toBe(
      "3.5rem"
    )
    expect(container.querySelector('[data-slot="sidebar-rail"]')).toBeNull()
    expect(screen.getByText("Codex Router")).toHaveClass("font-logo")
    const brandMark = container.querySelector('[data-slot="brand-mark"]')
    expect(brandMark).toHaveClass("bg-current", "text-sidebar-foreground")
    expect(brandMark).toHaveClass("size-6")
    expect(brandMark).not.toHaveClass("bg-primary")
    expect(brandMark).toHaveAttribute(
      "style",
      expect.stringContaining("codex-router-icon.png")
    )

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }))

    expect(
      await screen.findByRole("button", { name: "展开导航栏" })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "展开导航栏" })).not.toHaveClass(
      "bg-primary"
    )
    const sidebarHeader = container.querySelector(
      '[data-slot="sidebar-header"]'
    )
    expect(sidebarHeader).toHaveClass("h-14")
    expect(sidebarHeader?.firstElementChild).toHaveClass("size-14")
    expect(screen.queryByText("Identity router")).not.toBeInTheDocument()
  })

  it("shows the 5-hour quota as a ring when the sidebar is collapsed", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ShellProviders>
        <AppSidebar
          page="accounts"
          onPageChange={vi.fn()}
          activeAccount={activeAccount(
            quotaWindow(25, 300),
            quotaWindow(90, 10_080)
          )}
        />
      </ShellProviders>
    )

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }))

    const ring = container.querySelector('[data-slot="collapsed-quota-ring"]')
    expect(ring).toHaveAttribute("aria-label", "5 小时额度剩余")
    expect(ring).toHaveAttribute("aria-valuenow", "75")
    expect(ring?.parentElement).toHaveClass(
      "group-data-[collapsible=icon]:w-full",
      "group-data-[collapsible=icon]:justify-center"
    )
    expect(
      screen.getByRole("button", { name: "5 小时额度剩余 · 75%" })
    ).toBeInTheDocument()
  })

  it("falls back to the weekly quota ring when no 5-hour window exists", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <ShellProviders>
        <AppSidebar
          page="accounts"
          onPageChange={vi.fn()}
          activeAccount={activeAccount(null, quotaWindow(40, 10_080))}
        />
      </ShellProviders>
    )

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }))

    const ring = container.querySelector('[data-slot="collapsed-quota-ring"]')
    expect(ring).toHaveAttribute("aria-label", "7 天额度剩余")
    expect(ring).toHaveAttribute("aria-valuenow", "60")
  })

  it("renders a one-line header with compact uptime", () => {
    const { container } = render(
      <ShellProviders>
        <AppHeader page="accounts" online uptimeSeconds={93_600} />
      </ShellProviders>
    )

    expect(screen.getByText("账号路由")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("运行 1 天 2 小时")
    expect(screen.queryByText("身份、认证与流量控制")).not.toBeInTheDocument()
    expect(container.querySelector('[data-slot="badge"]')).toBeNull()
  })

  it("shows an offline warning instead of stale uptime", () => {
    render(
      <ShellProviders>
        <AppHeader page="gateway" online={false} uptimeSeconds={93_600} />
      </ShellProviders>
    )

    expect(screen.getByRole("status")).toHaveTextContent("Codex Router 离线")
    expect(screen.queryByText("运行 1 天 2 小时")).not.toBeInTheDocument()
  })
})
