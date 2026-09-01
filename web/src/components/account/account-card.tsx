import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { CircleDollarSignIcon, RefreshCwIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { AccountActions, type AccountAction } from "./account-actions"
import { AccountStatus } from "./account-status-badge"
import { QuotaMeter } from "./account-usage"
import { OpenAiMark } from "@/components/app/openai-mark"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  QUOTA_STALE_MS,
  SLOT_WINDOW_MINS,
  accountWindowSlots,
  isDisabled,
  isRoutable,
} from "@/lib/account-state"
import { nextBillingAt } from "@/lib/billing-cycle"
import {
  formatBillingCountdown,
  formatDateOnly,
  formatRelativeTime,
  shortAccountId,
} from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AccountView } from "@/services/contracts"

type Translate = (key: string, values?: Record<string, unknown>) => string

/**
 * A repair button is only for states that stay broken until someone acts on
 * them. A deliberately disabled account is not a fault, and checking, waiting
 * or rate-limited accounts resolve without help.
 */
function remedy(account: AccountView, t: Translate) {
  if (isRoutable(account) || !account.enabled) return null
  const blocked =
    account.auth.status === "relogin_required" ||
    account.auth.status === "error"
  return blocked ? { label: t("刷新认证"), action: "auth" as const } : null
}

export function AccountCard({
  account,
  busy,
  now,
  onAction,
}: {
  account: AccountView
  busy: boolean
  now: number
  onAction(action: AccountAction): void
}) {
  const { t } = useTranslation()
  const slots = accountWindowSlots(account)
  const repair = remedy(account, t)
  const routable = isRoutable(account)
  const accountId = shortAccountId(account.chatgptAccountId)
  const known = account.limits.buckets.length > 0
  const fallback =
    account.limits.checkedAt === null ? t("额度尚未刷新") : t("额度数据不可用")
  // The freshness stamp carries staleness: it is the one line already about how
  // current these numbers are.
  const stale =
    account.auth.stale ||
    (account.limits.checkedAt !== null &&
      now - account.limits.checkedAt > QUOTA_STALE_MS)
  const nextBilling = nextBillingAt(
    account.billing.anchorAt,
    account.billing.cadence,
    now
  )

  return (
    <article
      data-slot="account-card"
      className={cn(
        "rounded-2xl bg-card p-2 ring-1 ring-foreground/10",
        isDisabled(account) && "opacity-65"
      )}
    >
      <header className="flex items-center gap-3 px-1 py-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <RadioPrimitive.Root
                value={account.id}
                disabled={busy || !routable}
                aria-label={t("路由到 {{account}}", { account: accountId })}
                // Direct from base-ui rather than the RadioGroupItem wrapper:
                // the control is the brand mark itself, not a dot.
                //
                // Only an unroutable account is dimmed and blocked. A switch in
                // flight leaves the control untouched, so the cursor does not
                // flicker on the way through; the mark's spin carries that.
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-xl transition-colors outline-none",
                  "focus-visible:ring-3 focus-visible:ring-ring/50",
                  "data-checked:bg-primary/10 data-checked:text-primary",
                  "data-unchecked:bg-muted data-unchecked:text-foreground",
                  routable
                    ? // Held explicitly: a switch in flight sets aria-disabled,
                      // which would otherwise drop the base pointer rule.
                      "cursor-pointer data-unchecked:hover:bg-primary/10 data-unchecked:hover:text-primary"
                    : "cursor-not-allowed opacity-40"
                )}
              />
            }
          >
            {/* Spins while it is the route, and from the moment it is asked to
                become one, so the switch reads as continuous. */}
            <OpenAiMark
              className={cn(
                "size-[1.375rem]",
                (account.isActive || busy) && "motion-safe:animate-route-spin"
              )}
            />
          </TooltipTrigger>
          <TooltipContent>
            {account.isActive
              ? t("当前路由账号")
              : routable
                ? t("把后续请求切换到这个账号")
                : t("该账号当前不可路由")}
          </TooltipContent>
        </Tooltip>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="min-w-0 truncate rounded-sm text-left text-sm font-semibold underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
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
            {account.isActive ? (
              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {t("当前路由")}
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {account.email ?? t("未记录邮箱")}
          </p>
        </div>

        <AccountActions account={account} disabled={busy} onAction={onAction} />
      </header>

      <div className="mt-1 rounded-xl bg-muted/60 p-3">
        <div className="mb-4 flex items-center justify-between gap-3">
          <AccountStatus account={account} />
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap",
              stale ? "text-warning" : "text-muted-foreground-subtle"
            )}
          >
            <RefreshCwIcon aria-hidden="true" className="size-3.5" />
            {formatRelativeTime(account.limits.checkedAt, now)}
          </span>
        </div>

        <div className="grid gap-3">
          {slots.map((window, index) => (
            <QuotaMeter
              key={
                window
                  ? `${window.windowDurationMins}-${index}`
                  : `slot-${index}`
              }
              window={window}
              placeholderMins={SLOT_WINDOW_MINS[index]}
              known={known}
              fallback={index === 0 ? fallback : undefined}
            />
          ))}
        </div>

        <div className="mt-4 flex h-8 items-center justify-between gap-3 border-t border-border pt-3">
          <span
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-xs",
              nextBilling !== null ? "text-primary" : "text-muted-foreground"
            )}
          >
            <CircleDollarSignIcon
              aria-hidden="true"
              className="size-3.5 shrink-0"
            />
            <span className="truncate">
              {nextBilling === null
                ? t("未设置自动续订时间")
                : t("{{date}} 自动续订 · {{countdown}}", {
                    date: formatDateOnly(nextBilling),
                    countdown: formatBillingCountdown(nextBilling, now),
                  })}
            </span>
          </span>
          {repair ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onAction(repair.action)}
            >
              {repair.label}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  )
}
