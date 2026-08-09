import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { shortAccountId, formatRelativeTime } from "@/lib/format"
import type { AccountView } from "@/services/contracts"
import { AccountActions } from "./account-actions"
import { AccountStatusBadge } from "./account-status-badge"
import { AccountUsage } from "./account-usage"

export function AccountCard({
  account,
  busy,
  onAction,
}: {
  account: AccountView
  busy?: boolean
  onAction(action: "copy" | "limits" | "auth" | "toggle" | "remove"): void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={<span className="truncate font-mono text-sm" />}
            >
              {shortAccountId(account.chatgptAccountId)}
            </TooltipTrigger>
            <TooltipContent>
              {account.chatgptAccountId ?? "Account ID unavailable"}
            </TooltipContent>
          </Tooltip>
          {account.isActive ? <Badge variant="outline">当前</Badge> : null}
        </CardTitle>
        <CardDescription className="truncate">
          {account.email ?? "无邮箱"} · {account.planType ?? "未知套餐"}
        </CardDescription>
        <CardAction>
          <AccountActions
            account={account}
            disabled={busy}
            onAction={onAction}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <AccountStatusBadge account={account} />
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(account.lastLimitsRefreshAt)}
          </span>
        </div>
        <AccountUsage usage={account.usage} />
      </CardContent>
    </Card>
  )
}
