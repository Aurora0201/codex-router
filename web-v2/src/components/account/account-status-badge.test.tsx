import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { AccountView, AuthStatus } from "@/services/contracts"
import { AccountStatus } from "./account-status-badge"

function accountWithStatus(authStatus: AuthStatus): AccountView {
  return {
    id: authStatus,
    chatgptAccountId: `account-${authStatus}`,
    email: null,
    planType: null,
    enabled: authStatus !== "disabled",
    isActive: false,
    authStatus,
    rateLimitReachedType: null,
    usage: { primary: null, secondary: null },
    lastAuthRefreshAt: null,
    lastLimitsRefreshAt: null,
  }
}

describe("AccountStatus", () => {
  it.each([
    ["login_pending", "等待登录"],
    ["ready", "认证就绪"],
    ["refreshing", "正在刷新"],
    ["rate_limited", "额度受限"],
    ["relogin_required", "需要重新登录"],
    ["unsupported_fedramp", "不支持 FedRAMP"],
    ["disabled", "已停用"],
    ["error", "认证异常"],
  ] satisfies [AuthStatus, string][])(
    "renders the %s status with Nova icon treatment",
    (status, label) => {
      const { container } = render(
        <AccountStatus account={accountWithStatus(status)} />
      )

      expect(screen.getByText(label)).toBeInTheDocument()
      expect(container.querySelector("svg")).not.toBeNull()
      expect(container.querySelector('[data-slot="badge"]')).toBeNull()
    }
  )

  it("uses a spinner while authentication refreshes", () => {
    render(<AccountStatus account={accountWithStatus("refreshing")} />)

    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument()
  })
})
