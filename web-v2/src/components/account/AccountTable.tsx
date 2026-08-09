import { useEffect, useRef } from "react"

import {
  AccountIdentity,
  AccountMenu,
  type AccountAction,
} from "@/components/account/AccountCard"
import { AccountStatusBadge } from "@/components/account/AccountStatusBadge"
import { AccountUsage } from "@/components/account/AccountUsage"
import { Card } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatRelativeTime } from "@/lib/format"
import type { Account } from "@/services/contracts"

interface AccountTableProps {
  accounts: Account[]
  activeAccountId: string | null
  busy: string | null
  onAction(account: Account, action: AccountAction): void
}

export function AccountTable({
  accounts,
  activeAccountId,
  busy,
  onAction,
}: AccountTableProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRowRef = useRef<HTMLTableRowElement>(null)

  useEffect(() => {
    const row = activeRowRef.current
    const viewport = containerRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    )
    if (!row || !viewport) return

    const rowRect = row.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    const headerHeight = 40
    const visibleTop = viewportRect.top + headerHeight

    if (rowRect.top < visibleTop) {
      viewport.scrollTop += rowRect.top - visibleTop
    } else if (rowRect.bottom > viewportRect.bottom) {
      viewport.scrollTop += rowRect.bottom - viewportRect.bottom
    }
  }, [activeAccountId])

  return (
    <Card
      ref={containerRef}
      className="hidden h-[30rem] flex-col gap-0 overflow-hidden py-0 md:flex"
    >
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=table-container]]:overflow-visible">
        <Table className="table-fixed">
          <TableHeader className="sticky top-0 z-10 bg-card shadow-sm">
            <TableRow>
              <TableHead className="w-[28%] px-4">账号</TableHead>
              <TableHead className="w-32 px-3">状态</TableHead>
              <TableHead className="px-3">用量额度</TableHead>
              <TableHead className="w-24 px-3">最近更新</TableHead>
              <TableHead className="w-14 px-2">
                <span className="sr-only">操作</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((account) => {
              const active = account.id === activeAccountId
              return (
                <TableRow
                  key={account.id}
                  ref={active ? activeRowRef : undefined}
                  data-state={active ? "selected" : undefined}
                  className="h-[4.75rem]"
                >
                  <TableCell className="px-4 py-3">
                    <AccountIdentity account={account} active={active} />
                  </TableCell>
                  <TableCell className="px-3 py-3">
                    <AccountStatusBadge status={account.authStatus} />
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <div className="divide-y divide-border/70">
                      <AccountUsage fallbackLabel="短周期额度" window={account.usage.primary} compact />
                      <AccountUsage fallbackLabel="长周期额度" window={account.usage.secondary} compact />
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-3 text-xs text-muted-foreground">
                    {formatRelativeTime(account.lastLimitsRefreshAt)}
                  </TableCell>
                  <TableCell className="px-2 py-3">
                    <AccountMenu
                      account={account}
                      busy={busy === account.id}
                      onAction={(action) => onAction(account, action)}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </ScrollArea>
      <div className="flex h-11 shrink-0 items-center border-t bg-card px-4 text-xs text-muted-foreground">
        共 {accounts.length} 个账号
      </div>
    </Card>
  )
}
