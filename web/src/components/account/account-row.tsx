import { GaugeIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { AccountActions, type AccountAction } from "./account-actions"
import { AccountStatus } from "./account-status-badge"
import { QuotaMeter } from "./account-usage"
import { Button } from "@/components/ui/button"
import { RadioGroupItem } from "@/components/ui/radio-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  QUOTA_STALE_MS,
  accountWindows,
  isRoutable,
  subscriptionExpired,
  subscriptionExpiringSoon,
} from "@/lib/account-state"
import { formatRelativeTime, shortAccountId } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AccountView } from "@/services/contracts"

type Translate = (key: string, values?: Record<string, unknown>) => string

/**
 * At most one qualifier per row. Stacking every warning at once turns the list
 * into noise, so only the most urgent one earns the second line.
 */
function qualifier(account: AccountView, now: number, t: Translate) {
  if (subscriptionExpired(account, now))
    return { label: t("订阅已过期"), tone: "text-destructive" }
  if (account.subscription.source === "legacy_estimate")
    return { label: t("到期日待确认"), tone: "text-warning" }
  if (subscriptionExpiringSoon(account, now))
    return { label: t("订阅即将到期"), tone: "text-warning" }
  if (account.auth.stale)
    return { label: t("认证数据已陈旧"), tone: "text-muted-foreground" }
  if (
    account.limits.checkedAt !== null &&
    now - account.limits.checkedAt > QUOTA_STALE_MS
  )
    return {
      label: t("额度读数 {{time}}", {
        time: formatRelativeTime(account.limits.checkedAt, now),
      }),
      tone: "text-muted-foreground",
    }
  return null
}

/**
 * The radio only covers routable accounts. A row that cannot be routed offers
 * its own repair instead, so no row is ever a dead end.
 */
function remedy(account: AccountView, t: Translate) {
  if (isRoutable(account)) return null
  if (!account.enabled)
    return { label: t("启用账号"), action: "toggle" as const }
  return { label: t("刷新认证"), action: "auth" as const }
}

export function AccountRow({
  account,
  busy,
  now,
  mobile,
  onAction,
}: {
  account: AccountView
  busy: boolean
  now: number
  mobile: boolean
  onAction(action: AccountAction): void
}) {
  const { t } = useTranslation()
  const windows = accountWindows(account)
  const note = qualifier(account, now, t)
  const repair = remedy(account, t)
  const accountId = shortAccountId(account.chatgptAccountId)

  const radio = (
    <Tooltip>
      <TooltipTrigger
        render={
          <RadioGroupItem
            value={account.id}
            disabled={busy || repair !== null}
            aria-label={t("路由到 {{account}}", { account: accountId })}
            // base-ui marks the state with data-disabled, not :disabled, so the
            // primitive's own disabled styling never fires here.
            className="data-disabled:cursor-not-allowed data-disabled:opacity-40"
          />
        }
      />
      <TooltipContent>
        {account.isActive
          ? t("当前路由账号")
          : repair
            ? t("该账号当前不可路由")
            : t("把后续请求切换到这个账号")}
      </TooltipContent>
    </Tooltip>
  )

  const identity = (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="max-w-full truncate rounded-sm text-left font-mono text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => onAction("detail")}
          />
        }
      >
        {accountId}
      </TooltipTrigger>
      <TooltipContent>
        {t("查看 {{account}} 的账号详情", {
          account: account.chatgptAccountId ?? accountId,
        })}
      </TooltipContent>
    </Tooltip>
  )

  const email = (
    <span className="block truncate text-xs text-muted-foreground">
      {account.email ?? t("未记录邮箱")}
    </span>
  )

  const meters = windows.length ? (
    <>
      {windows.map((window, index) => (
        <QuotaMeter
          key={`${window.windowDurationMins}-${index}`}
          window={window}
        />
      ))}
      {windows.length === 1 ? <div aria-hidden="true" className="h-5" /> : null}
    </>
  ) : (
    <>
      <div className="flex h-5 items-center gap-1.5 text-xs text-muted-foreground">
        <GaugeIcon aria-hidden="true" className="size-3.5" />
        {account.limits.checkedAt === null
          ? t("额度尚未刷新")
          : t("额度数据不可用")}
      </div>
      <div aria-hidden="true" className="h-5" />
    </>
  )

  const repairButton = repair ? (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={() => onAction(repair.action)}
    >
      {repair.label}
    </Button>
  ) : null

  if (mobile) {
    return (
      <div
        data-slot="account-row"
        className={cn("px-4 py-3", account.isActive && "bg-primary/[0.04]")}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-5 items-center">{radio}</div>
          <div className="min-w-0 flex-1">
            {identity}
            {email}
          </div>
          <AccountActions
            account={account}
            disabled={busy}
            onAction={onAction}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7">
          <AccountStatus account={account} />
          {note ? (
            <span className={cn("text-xs", note.tone)}>{note.label}</span>
          ) : null}
        </div>
        <div className="mt-2.5 space-y-1 pl-7">{meters}</div>
        {repairButton ? <div className="mt-3 pl-7">{repairButton}</div> : null}
      </div>
    )
  }

  return (
    <div
      data-slot="account-row"
      className={cn(
        "flex items-center gap-4 px-4 py-2.5 transition-colors",
        account.isActive ? "bg-primary/[0.04]" : "hover:bg-muted/40"
      )}
    >
      {radio}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,13rem)_minmax(0,9rem)_minmax(0,26rem)_minmax(0,1fr)] items-start gap-x-5">
        <div className="min-w-0 space-y-1">
          <div className="flex h-5 items-center">{identity}</div>
          <div className="flex h-5 items-center">{email}</div>
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex h-5 items-center">
            <AccountStatus account={account} />
          </div>
          <div className="flex h-5 items-center">
            {note ? (
              <span className={cn("truncate text-xs", note.tone)}>
                {note.label}
              </span>
            ) : null}
          </div>
        </div>
        <div className="min-w-0 space-y-1">{meters}</div>
        <div className="flex items-center justify-end gap-1.5 self-center">
          {repairButton}
          <AccountActions
            account={account}
            disabled={busy}
            onAction={onAction}
          />
        </div>
      </div>
    </div>
  )
}
