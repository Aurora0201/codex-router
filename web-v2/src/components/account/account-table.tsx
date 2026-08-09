import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatRelativeTime, shortAccountId } from "@/lib/format"
import type { AccountView } from "@/services/contracts"
import { AccountActions } from "./account-actions"
import { AccountStatusBadge } from "./account-status-badge"
import { AccountUsage } from "./account-usage"

export function AccountTable({
  accounts,
  busyId,
  onAction,
}: {
  accounts: AccountView[]
  busyId: string | null
  onAction(
    account: AccountView,
    action: "copy" | "limits" | "auth" | "toggle" | "remove"
  ): void
}) {
  return (
    <Card className="hidden h-[30rem] min-h-0 md:flex md:flex-col">
      <CardHeader className="shrink-0">
        <CardTitle>授权账号</CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 p-0">
        <ScrollArea className="h-full">
          <Table className="table-fixed">
            <TableHeader className="sticky top-0 bg-card">
              <TableRow>
                <TableHead className="w-[24%] pl-6">账号</TableHead>
                <TableHead className="w-[13%]">状态</TableHead>
                <TableHead className="w-[43%]">用量额度</TableHead>
                <TableHead className="w-[14%] text-right">最近刷新</TableHead>
                <TableHead className="w-[6%]">
                  <span className="sr-only">操作</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow
                  key={account.id}
                  data-active={account.isActive || undefined}
                  className="data-[active=true]:bg-accent/50"
                >
                  <TableCell className="pl-6 align-top">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="truncate font-mono font-medium" />
                            }
                          >
                            {shortAccountId(account.chatgptAccountId)}
                          </TooltipTrigger>
                          <TooltipContent>
                            {account.chatgptAccountId ??
                              "Account ID unavailable"}
                          </TooltipContent>
                        </Tooltip>
                        {account.isActive ? (
                          <Badge variant="outline">当前</Badge>
                        ) : null}
                      </div>
                      <span className="truncate text-xs text-muted-foreground">
                        {account.email ?? "无邮箱"} ·{" "}
                        {account.planType ?? "未知套餐"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">
                    <AccountStatusBadge account={account} />
                  </TableCell>
                  <TableCell className="align-top">
                    <AccountUsage usage={account.usage} />
                  </TableCell>
                  <TableCell className="text-right align-top text-xs text-muted-foreground">
                    {formatRelativeTime(account.lastLimitsRefreshAt)}
                  </TableCell>
                  <TableCell className="pr-4 text-right align-top">
                    <AccountActions
                      account={account}
                      disabled={busyId === account.id}
                      onAction={(action) => onAction(account, action)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
      <CardFooter className="shrink-0 justify-between">
        <span className="text-sm text-muted-foreground">
          共 {accounts.length} 个账号
        </span>
        <span className="text-xs text-muted-foreground">
          列表区域保持固定高度
        </span>
      </CardFooter>
    </Card>
  )
}
