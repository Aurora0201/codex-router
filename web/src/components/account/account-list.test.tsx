import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { AccountView } from "@/services/contracts"
import { AccountList } from "./account-list"

function account(values: Partial<AccountView>): AccountView {
  return {
    id: "account-1",
    chatgptAccountId: "account-1234567890",
    email: "user@example.com",
    planType: "Plus",
    enabled: true,
    isActive: false,
    authStatus: "ready",
    rateLimitReachedType: null,
    usage: { primary: null, secondary: null },
    lastAuthRefreshAt: null,
    lastLimitsRefreshAt: null,
    ...values,
  }
}

describe("AccountList", () => {
  it("selects a ready account and keeps row actions available", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const accounts = [
      account({ id: "active", isActive: true }),
      account({ id: "candidate", chatgptAccountId: "account-candidate" }),
    ]

    render(
      <TooltipProvider>
        <AccountList
          accounts={accounts}
          busyId={null}
          onSelect={onSelect}
          onAction={vi.fn()}
        />
      </TooltipProvider>
    )

    const [activeRadio, candidateRadio] = screen.getAllByRole("radio", {
      name: /设为当前路由/,
    })

    expect(activeRadio).toBeChecked()
    await user.click(candidateRadio)

    expect(onSelect).toHaveBeenCalledWith(accounts[1])
    expect(activeRadio).toBeChecked()
    expect(screen.queryByText("当前路由")).not.toBeInTheDocument()
    expect(screen.queryByText("设为当前")).not.toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "账号操作" })).toHaveLength(2)
  })

  it("orders route selection, identity, usage, and secondary actions by priority", () => {
    const { container } = render(
      <TooltipProvider>
        <AccountList
          accounts={[
            account({
              email: "a-very-long-account-address@example.com",
              authStatus: "error",
            }),
          ]}
          busyId={null}
          onSelect={vi.fn()}
          onAction={vi.fn()}
        />
      </TooltipProvider>
    )

    const item = container.querySelector('[data-slot="item"]')
    const media = item?.querySelector('[data-slot="item-media"]')
    const content = item?.querySelector('[data-slot="item-content"]')
    const usage = item?.querySelector('[data-slot="account-usage"]')
    const actions = item?.querySelector('[data-slot="item-actions"]')

    expect(item?.querySelector('[data-slot="item-header"]')).toBeNull()
    expect(item?.querySelector('[data-slot="item-footer"]')).toBeNull()
    expect(media?.contains(screen.getByRole("radio"))).toBe(true)
    expect(media?.compareDocumentPosition(content as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(content?.compareDocumentPosition(usage as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(usage?.compareDocumentPosition(actions as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(usage).toHaveClass("col-end-3", "xl:col-end-4")
    expect(actions).toHaveClass("row-end-3", "xl:row-end-2")
    expect(
      screen.getByText("a-very-long-account-address@example.com")
    ).toBeInTheDocument()
    expect(screen.getByText("认证异常")).toBeInTheDocument()
  })

  it("keeps authentication status directly after the account id", () => {
    const { container } = render(
      <TooltipProvider>
        <AccountList
          accounts={[
            account({
              chatgptAccountId:
                "account-with-an-intentionally-long-identifier-1234567890",
              authStatus: "ready",
            }),
          ]}
          busyId={null}
          onSelect={vi.fn()}
          onAction={vi.fn()}
        />
      </TooltipProvider>
    )

    const title = container.querySelector('[data-slot="item-title"]')
    const status = title?.querySelector('[data-slot="account-status"]')

    expect(title?.children).toHaveLength(2)
    expect(title?.lastElementChild).toBe(status)
    expect(title).toHaveClass(
      "flex-nowrap",
      "whitespace-nowrap",
      "[display:flex]",
      "[-webkit-line-clamp:unset]"
    )
    expect(title?.firstElementChild).toHaveClass("min-w-0", "truncate")
    expect(title?.firstElementChild).not.toHaveClass("flex-1")
    expect(status).not.toHaveClass("ml-auto")
    expect(status).toHaveClass("shrink-0", "whitespace-nowrap")
    expect(status).toHaveTextContent("认证就绪")
  })

  it("reveals the scrollbar on interaction and fades overflowing edges", () => {
    const { container } = render(
      <TooltipProvider>
        <AccountList
          accounts={[account({})]}
          busyId={null}
          onSelect={vi.fn()}
          onAction={vi.fn()}
        />
      </TooltipProvider>
    )

    const scrollArea = container.querySelector('[data-slot="scroll-area"]')

    expect(scrollArea).toHaveClass(
      "[&_[data-slot=scroll-area-scrollbar]]:opacity-0",
      "[&_[data-slot=scroll-area-scrollbar][data-hovering]]:opacity-100",
      "[&_[data-slot=scroll-area-scrollbar][data-scrolling]]:opacity-100",
      "focus-within:[&_[data-slot=scroll-area-scrollbar]]:opacity-100",
      "data-[overflow-y-start]:before:opacity-100",
      "data-[overflow-y-end]:after:opacity-100"
    )
    expect(scrollArea).toHaveClass("before:h-5", "after:h-5")
    expect(scrollArea?.className).not.toContain("backdrop-blur")
  })

  it("uses a larger outlined action button and a non-wrapping menu", async () => {
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <AccountList
          accounts={[account({})]}
          busyId={null}
          onSelect={vi.fn()}
          onAction={vi.fn()}
        />
      </TooltipProvider>
    )

    const actionButton = screen.getByRole("button", { name: "账号操作" })
    expect(actionButton).toHaveClass("size-8", "border-border")

    await user.click(actionButton)

    const menuItem = await screen.findByText("复制 Account ID")
    expect(menuItem.closest('[data-slot="dropdown-menu-content"]')).toHaveClass(
      "w-44",
      "whitespace-nowrap"
    )
  })

  it("searches accounts by id or email and clears an empty result", async () => {
    const user = userEvent.setup()

    render(
      <TooltipProvider>
        <AccountList
          accounts={[
            account({
              id: "ready",
              chatgptAccountId: "account-ready-123",
              email: "ready@example.com",
            }),
            account({
              id: "disabled",
              chatgptAccountId: "account-disabled-456",
              email: "operations@example.com",
              enabled: false,
              authStatus: "disabled",
            }),
          ]}
          busyId={null}
          onSelect={vi.fn()}
          onAction={vi.fn()}
        />
      </TooltipProvider>
    )

    const search = screen.getByRole("textbox", { name: "搜索授权账号" })
    expect(screen.getByText("显示 2 / 共 2")).toBeInTheDocument()

    await user.type(search, "OPERATIONS")
    expect(screen.getByText("operations@example.com")).toBeInTheDocument()
    expect(screen.queryByText("ready@example.com")).not.toBeInTheDocument()
    expect(screen.getByText("显示 1 / 共 2")).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, "disabled-456")
    expect(screen.getByText("operations@example.com")).toBeInTheDocument()

    await user.clear(search)
    await user.type(search, "missing-account")
    expect(screen.getByText("没有匹配的账号")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "清除筛选" }))
    expect(screen.getAllByRole("radio")).toHaveLength(2)
    expect(search).toHaveValue("")
  })

  it.each([
    {
      option: "可路由（1）",
      visible: "ready@example.com",
      hidden: ["attention@example.com", "disabled@example.com"],
    },
    {
      option: "需处理（1）",
      visible: "attention@example.com",
      hidden: ["ready@example.com", "disabled@example.com"],
    },
    {
      option: "已停用（1）",
      visible: "disabled@example.com",
      hidden: ["ready@example.com", "attention@example.com"],
    },
  ])("filters accounts with $option", async ({ option, visible, hidden }) => {
    const user = userEvent.setup()
    const accounts = [
      account({ id: "ready", email: "ready@example.com" }),
      account({
        id: "attention",
        email: "attention@example.com",
        authStatus: "error",
      }),
      account({
        id: "disabled",
        email: "disabled@example.com",
        enabled: false,
        authStatus: "disabled",
      }),
    ]

    render(
      <TooltipProvider>
        <AccountList
          accounts={accounts}
          busyId={null}
          onSelect={vi.fn()}
          onAction={vi.fn()}
        />
      </TooltipProvider>
    )

    const filter = screen.getByRole("combobox", { name: "筛选账号状态" })

    await user.click(filter)
    await user.click(await screen.findByRole("option", { name: option }))
    expect(screen.getByText(visible)).toBeInTheDocument()
    hidden.forEach((email) => {
      expect(screen.queryByText(email)).not.toBeInTheDocument()
    })
    expect(screen.getByText("显示 1 / 共 3")).toBeInTheDocument()
  })

  it("preserves the service account order", () => {
    const { container } = render(
      <TooltipProvider>
        <AccountList
          accounts={[
            account({ id: "first", email: "first@example.com" }),
            account({ id: "second", email: "second@example.com" }),
            account({ id: "third", email: "third@example.com" }),
          ]}
          busyId={null}
          onSelect={vi.fn()}
          onAction={vi.fn()}
        />
      </TooltipProvider>
    )

    expect(
      Array.from(container.querySelectorAll('[role="listitem"]')).map(
        (item) => item.textContent
      )
    ).toEqual([
      expect.stringContaining("first@example.com"),
      expect.stringContaining("second@example.com"),
      expect.stringContaining("third@example.com"),
    ])
  })

  it("disables route selection for unavailable accounts", () => {
    render(
      <TooltipProvider>
        <AccountList
          accounts={[account({ enabled: false, authStatus: "disabled" })]}
          busyId={null}
          onSelect={vi.fn()}
          onAction={vi.fn()}
        />
      </TooltipProvider>
    )

    expect(screen.getByRole("radio")).toHaveAttribute("aria-disabled", "true")
  })

  it("shows a spinner and locks route selection while switching", () => {
    render(
      <TooltipProvider>
        <AccountList
          accounts={[
            account({ id: "active", isActive: true }),
            account({ id: "candidate" }),
          ]}
          busyId="candidate"
          onSelect={vi.fn()}
          onAction={vi.fn()}
        />
      </TooltipProvider>
    )

    expect(
      screen.getByRole("status", { name: "正在切换路由账号" })
    ).toBeInTheDocument()
    expect(screen.getByRole("radio")).toHaveAttribute("aria-disabled", "true")
  })
})
