import { useTranslation } from "react-i18next"

import { AccountActions, type AccountAction } from "./account-actions"
import { AccountStatus } from "./account-status-badge"
import { QuotaMeter } from "./account-usage"
import { OpenAiMark } from "@/components/app/openai-mark"
import { Button } from "@/components/ui/button"
import { RadioGroupItem } from "@/components/ui/radio-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  QUOTA_STALE_MS,
  SLOT_WINDOW_MINS,
  accountWindowSlots,
  isRoutable,
  subscriptionExpired,
  subscriptionExpiringSoon,
} from "@/lib/account-state"
import {
  formatDateOnly,
  formatRelativeTime,
  shortAccountId,
} from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AccountView } from "@/services/contracts"

/**
 * Two 24px baselines shared by every column, and a flexible status track that
 * absorbs the leftover width so it reads as a gap between "who" and "how much"
 * instead of a void at the end of the row.
 */
export const ROW_COLUMNS =
  "grid-cols-[minmax(0,14rem)_minmax(0,9rem)_minmax(0,1fr)_minmax(0,1fr)_auto]"
/** The row adds the two baselines; the column header only borrows the tracks. */
export const ROW_BASELINES = "grid-rows-[1.25rem_1.25rem] gap-y-1"
export const ACTIONS_CELL = "col-start-5"

type Translate = (key: string, values?: Record<string, unknown>) => string

/**
 * At most one qualifier per row. Stacking every warning at once turns the list
 * into noise, so only the most urgent one earns the second line.
 */
function qualifier(account: AccountView, now: number, t: Translate) {
  // The date itself is the label: "2026-09-15 到期" answers the follow-up
  // question that "订阅即将到期" only raises.
  const expiresAt = formatDateOnly(account.subscription.expiresAt)
  if (subscriptionExpired(account, now))
    return {
      label: t("已于 {{date}} 到期", { date: expiresAt }),
      tone: "text-destructive",
    }
  if (account.subscription.source === "legacy_estimate")
    return {
      label: t("{{date}} 到期 · 待确认", { date: expiresAt }),
      tone: "text-warning",
    }
  if (subscriptionExpiringSoon(account, now))
    return {
      label: t("{{date}} 到期", { date: expiresAt }),
      tone: "text-warning",
    }
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
  const slots = accountWindowSlots(account)
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

  const known = account.limits.buckets.length > 0
  const fallback =
    account.limits.checkedAt === null ? t("额度尚未刷新") : t("额度数据不可用")
  const meters = slots.map((window, index) => (
    <QuotaMeter
      key={window ? `${window.windowDurationMins}-${index}` : `slot-${index}`}
      window={window}
      placeholderMins={SLOT_WINDOW_MINS[index]}
      known={known}
      fallback={index === 0 ? fallback : undefined}
    />
  ))

  const avatar = (
    <span
      aria-hidden="true"
      className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground"
    >
      <OpenAiMark className="size-6" />
    </span>
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
        className={cn(
          "relative px-4 py-3 after:pointer-events-none after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border last:after:hidden",
          account.isActive && "bg-primary/[0.04]"
        )}
      >
        <div className="flex items-center gap-3">
          {radio}
          {avatar}
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
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <AccountStatus account={account} />
          {note ? (
            <span className={cn("text-xs", note.tone)}>{note.label}</span>
          ) : null}
        </div>
        <div className="mt-2.5 space-y-2">{meters}</div>
        {repairButton ? <div className="mt-3">{repairButton}</div> : null}
      </div>
    )
  }

  return (
    <div
      data-slot="account-row"
      className={cn(
        "flex items-center gap-4 px-4 py-2.5 transition-colors sm:px-6",
        "relative after:pointer-events-none after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border last:after:hidden",
        account.isActive ? "bg-primary/[0.04]" : "hover:bg-muted/40"
      )}
    >
      {radio}
      {avatar}
      {/* Every column shares the same two 24px rows via subgrid, so identity,
          status and the quota meters sit on the same two baselines. The slack
          lives between status and quota rather than trailing after the row. */}
      <div
        className={cn(
          "grid min-w-0 flex-1 gap-x-6",
          ROW_COLUMNS,
          ROW_BASELINES
        )}
      >
        <div className="row-span-2 grid min-w-0 grid-rows-subgrid">
          <div className="flex items-center">{identity}</div>
          <div className="flex items-center">{email}</div>
        </div>
        <div className="row-span-2 grid min-w-0 grid-rows-subgrid">
          <div className="flex items-center">
            <AccountStatus account={account} />
          </div>
          <div className="flex items-center">
            {note ? (
              <span className={cn("truncate text-xs", note.tone)}>
                {note.label}
              </span>
            ) : null}
          </div>
        </div>
        {meters}
        <div
          className={cn(
            "row-span-2 flex items-center justify-end gap-1.5",
            ACTIONS_CELL
          )}
        >
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
