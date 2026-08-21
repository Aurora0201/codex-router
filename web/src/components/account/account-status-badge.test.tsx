import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { AccountView, AuthStatus } from "@/services/contracts"
import { AccountStatus } from "./account-status-badge"

function accountWithStatus(authStatus: AuthStatus): AccountView {
  return {
    id: authStatus, chatgptAccountId: "account-" + authStatus, email: null, planType: null,
    subscriptionStartedAt: null, subscriptionExpiresAt: null, enabled: authStatus !== "disabled",
    isActive: false, authStatus, rateLimitReachedType: null,
    usage: { primary: null, secondary: null }, lastAuthRefreshAt: null, lastLimitsRefreshAt: null,
    auth: { status: authStatus, mode: null, checkedAt: null, lastSuccessfulAt: null, stale: false, errorCode: null },
    subscription: { expiresAt: null, source: null },
    limits: { buckets: [], defaultBucketKey: null, resetCredits: null, checkedAt: null },
  }
}

describe("AccountStatus", () => {
  it.each([
    ["login_pending", "等待登录"], ["checking", "正在检查"], ["ready", "认证就绪"],
    ["refreshing", "正在刷新"], ["rate_limited", "额度受限"],
    ["relogin_required", "需要重新登录"], ["unsupported_fedramp", "不支持 FedRAMP"],
    ["disabled", "已停用"], ["error", "认证异常"],
  ] satisfies [AuthStatus, string][])("renders the %s status", (status, label) => {
    const { container } = render(<AccountStatus account={accountWithStatus(status)} />)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(container.querySelector("svg")).not.toBeNull()
  })

  it.each(["checking", "refreshing"] satisfies AuthStatus[])("uses a spinner while %s", (status) => {
    render(<AccountStatus account={accountWithStatus(status)} />)
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument()
  })

  it("uses success color only for ready", () => {
    render(<AccountStatus account={accountWithStatus("ready")} />)
    expect(screen.getByText("认证就绪").closest("span")).toHaveClass("text-success")
  })
})
