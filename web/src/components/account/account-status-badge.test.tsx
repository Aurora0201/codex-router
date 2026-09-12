import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { AccountView, AuthStatus } from "@/services/contracts"
import { AccountStatus } from "./account-status-badge"

function accountWithStatus(authStatus: AuthStatus): AccountView {
  return {
    id: authStatus,
    chatgptAccountId: "account-" + authStatus,
    email: null,
    planType: null,
    enabled: authStatus !== "disabled",
    isActive: false,
    authStatus,
    rateLimitReachedType: null,
    usage: { primary: null, secondary: null },
    lastAuthRefreshAt: null,
    lastLimitsRefreshAt: null,
    auth: {
      status: authStatus,
      mode: null,
      checkedAt: null,
      lastSuccessfulAt: null,
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
  }
}

describe("AccountStatus", () => {
  it.each([
    ["login_pending", "等待登录"],
    ["checking", "正在检查"],
    ["ready", "认证就绪"],
    ["refreshing", "正在刷新"],
    ["relogin_required", "需要重新登录"],
    ["unsupported_fedramp", "不支持 FedRAMP"],
    ["disabled", "已停用"],
    ["error", "认证异常"],
  ] satisfies [AuthStatus, string][])(
    "renders the %s status",
    (status, label) => {
      const { container } = render(
        <AccountStatus account={accountWithStatus(status)} />
      )
      expect(screen.getByText(label)).toBeInTheDocument()
      expect(container.querySelector("svg")).not.toBeNull()
    }
  )

  it.each(["checking", "refreshing"] satisfies AuthStatus[])(
    "uses a spinner while %s",
    (status) => {
      render(<AccountStatus account={accountWithStatus(status)} />)
      expect(
        screen.getByRole("status", { name: "Loading" })
      ).toBeInTheDocument()
    }
  )

  it.each([
    ["ready", "认证就绪", "text-primary"],
    ["disabled", "已停用", "text-muted-foreground"],
    ["login_pending", "等待登录", "text-muted-foreground"],
    // Routing stays blocked until someone acts.
    ["relogin_required", "需要重新登录", "text-destructive"],
    ["error", "认证异常", "text-destructive"],
    ["unsupported_fedramp", "不支持 FedRAMP", "text-destructive"],
  ] satisfies [AuthStatus, string, string][])(
    "tones %s by what it asks of you",
    (status, label, tone) => {
      render(<AccountStatus account={accountWithStatus(status)} />)
      expect(screen.getByText(label).closest("span")).toHaveClass(tone)
    }
  )
  it("says the same thing about two accounts reading the same numbers", () => {
    // The upstream's own flag only appears once it has refused a request, so
    // one account at 100% carried it and its neighbour at 100% did not — and
    // the two cards disagreed about what was going on.
    const spent = {
      buckets: [
        {
          key: "codex",
          limitId: null,
          limitName: "Codex",
          primary: {
            usedPercent: 100,
            resetsAt: Date.now() + 3_600_000,
            windowDurationMins: 300,
          },
          secondary: null,
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
    }
    const base = accountWithStatus("ready")

    const flagged = render(
      <AccountStatus
        account={{
          ...base,
          limits: spent,
          rateLimitReachedType: "rate_limit_reached",
        }}
      />
    )
    const unflagged = render(
      <AccountStatus account={{ ...base, limits: spent }} />
    )
    expect(within(flagged.container).getByText("额度受限")).toBeInTheDocument()
    expect(within(unflagged.container).getByText("额度受限")).toBeInTheDocument()
  })

  it("says 额度受限 over 认证就绪, without saying the credentials are bad", () => {
    // Quota moved out of the auth status, but it is still the more useful of
    // the two things to say on a healthy account that is over a limit.
    render(
      <AccountStatus
        account={{
          ...accountWithStatus("ready"),
          rateLimitReachedType: "primary",
        }}
      />
    )
    expect(screen.getByText("额度受限").closest("span")).toHaveClass(
      "text-warning"
    )
    expect(screen.queryByText("认证就绪")).toBeNull()
  })
})
