import { useMemo, useState } from "react"
import { RouteIcon, RouteOffIcon, SearchXIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { AccountDetailSheet } from "./account-detail-sheet"
import { AccountRow } from "./account-row"
import { AccountStatus } from "./account-status-badge"
import type { AccountAction } from "./account-actions"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  isDisabled,
  isRoutable,
  needsAttention,
  tightestRemaining,
} from "@/lib/account-state"
import { shortAccountId } from "@/lib/format"
import { cn } from "@/lib/utils"
import type {
  AccountView,
  RateLimitResetCreditView,
} from "@/services/contracts"

type AccountFilter = "all" | "routable" | "attention" | "disabled"

/** Rows the console can route through sit above rows that need repair. */
function rank(account: AccountView) {
  if (account.isActive) return 0
  if (isRoutable(account)) return 1
  if (isDisabled(account)) return 3
  return 2
}

export function AccountList({
  accounts,
  busyId,
  onSelect,
  onClearRoute,
  onAction,
  onConsumeReset,
}: {
  accounts: AccountView[]
  busyId: string | null
  onSelect(account: AccountView): void
  onClearRoute(): void
  onAction(account: AccountView, action: AccountAction): void
  onConsumeReset(
    account: AccountView,
    input: { idempotencyKey: string; creditId?: string }
  ): Promise<void>
}) {
  const { t } = useTranslation()
  const mobile = useIsMobile()
  const [now] = useState(Date.now)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<AccountFilter>("all")
  const [detail, setDetail] = useState<AccountView | null>(null)
  const [resetting, setResetting] = useState<{
    account: AccountView
    credit: RateLimitResetCreditView
    key: string
  } | null>(null)

  const counts = useMemo(
    () => ({
      all: accounts.length,
      routable: accounts.filter(isRoutable).length,
      attention: accounts.filter((a) => needsAttention(a, now)).length,
      disabled: accounts.filter(isDisabled).length,
    }),
    [accounts, now]
  )

  const normalized = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      accounts
        .filter((account) => {
          const text =
            !normalized ||
            account.email?.toLowerCase().includes(normalized) ||
            account.chatgptAccountId?.toLowerCase().includes(normalized)
          const state =
            filter === "all" ||
            (filter === "routable" && isRoutable(account)) ||
            (filter === "attention" && needsAttention(account, now)) ||
            (filter === "disabled" && isDisabled(account))
          return Boolean(text && state)
        })
        .map((account, index) => ({ account, index }))
        .sort((a, b) => {
          const byRank = rank(a.account) - rank(b.account)
          if (byRank !== 0) return byRank
          // Within routable accounts the roomiest one is the best next route.
          const left = tightestRemaining(a.account)
          const right = tightestRemaining(b.account)
          if (left !== right && left !== null && right !== null)
            return right - left
          return a.index - b.index
        })
        .map(({ account }) => account),
    [accounts, filter, normalized, now]
  )

  const active = accounts.find((account) => account.isActive) ?? null
  const activeRemaining = active ? tightestRemaining(active) : null

  const options: Array<{ value: AccountFilter; label: string; count: number }> =
    [
      { value: "all", label: t("全部"), count: counts.all },
      { value: "routable", label: t("可路由"), count: counts.routable },
      { value: "attention", label: t("需处理"), count: counts.attention },
      { value: "disabled", label: t("已停用"), count: counts.disabled },
    ]

  const handleAction = (account: AccountView, action: AccountAction) => {
    if (action === "detail") setDetail(account)
    else if (action === "clearRoute") onClearRoute()
    else onAction(account, action)
  }

  return (
    <>
      <Card className="gap-0 py-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/30 px-4 py-3">
          <RouteIcon
            aria-hidden="true"
            className={cn(
              "size-4",
              active ? "text-primary" : "text-muted-foreground"
            )}
          />
          <span className="text-sm text-muted-foreground">
            {active ? t("请求经由") : t("尚未选择路由账号")}
          </span>
          {active ? (
            <>
              <span className="font-mono text-sm font-medium">
                {shortAccountId(active.chatgptAccountId)}
              </span>
              <Separator orientation="vertical" className="h-4" />
              <AccountStatus account={active} />
              {activeRemaining !== null ? (
                <>
                  <Separator orientation="vertical" className="h-4" />
                  <span className="text-xs text-muted-foreground">
                    {t("最紧额度剩余 {{value}}%", {
                      value: Math.round(activeRemaining),
                    })}
                  </span>
                </>
              ) : null}
              <Button
                className="ml-auto"
                variant="ghost"
                size="sm"
                disabled={busyId !== null}
                onClick={onClearRoute}
              >
                <RouteOffIcon data-icon="inline-start" />
                {t("清除路由")}
              </Button>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t("· 请求使用 Codex 当前登录账号透传")}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2 border-b px-4 py-2.5 sm:flex-row sm:items-center">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("搜索授权账号")}
            placeholder={t("搜索 Account ID 或邮箱")}
            className="sm:max-w-xs"
          />
          <ToggleGroup
            value={[filter]}
            onValueChange={(value: string[]) =>
              setFilter((value[0] as AccountFilter | undefined) ?? "all")
            }
            variant="outline"
            size="sm"
            spacing={0}
            className="sm:ml-auto"
          >
            {options.map((option) => (
              <ToggleGroupItem
                key={option.value}
                value={option.value}
                aria-label={t("{{label}}（{{count}}）", {
                  label: option.label,
                  count: option.count,
                })}
              >
                <span aria-hidden="true">{option.label}</span>
                <span
                  aria-hidden="true"
                  className="font-mono tabular-nums opacity-60"
                >
                  {option.count}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {filtered.length ? (
          <>
            {mobile ? null : (
              <div
                aria-hidden="true"
                className="grid grid-cols-[minmax(0,13rem)_minmax(0,9rem)_minmax(0,1fr)_auto] gap-x-5 border-b border-l-2 border-l-transparent px-4 py-1.5 text-xs text-muted-foreground"
              >
                <span>{t("账号")}</span>
                <span>{t("状态")}</span>
                <span>{t("剩余额度")}</span>
                <span />
              </div>
            )}
            <ul className="divide-y">
              {filtered.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  busy={busyId === account.id}
                  now={now}
                  mobile={mobile}
                  onSelect={() => onSelect(account)}
                  onAction={(action) => handleAction(account, action)}
                />
              ))}
            </ul>
          </>
        ) : (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>{t("没有匹配的账号")}</EmptyTitle>
              <EmptyDescription>
                {t("调整搜索内容或状态筛选后再试。")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                variant="outline"
                onClick={() => {
                  setQuery("")
                  setFilter("all")
                }}
              >
                {t("清除筛选")}
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </Card>

      <AccountDetailSheet
        account={detail}
        onOpenChange={(open) => !open && setDetail(null)}
        onUseCredit={(account, credit) =>
          setResetting({ account, credit, key: crypto.randomUUID() })
        }
      />

      <AlertDialog
        open={resetting !== null}
        onOpenChange={(open) => !open && setResetting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("使用额度重置券？")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "此操作会立即尝试重置服务端额度。结果以 Codex 返回为准，客户端不会自行推断额度变化。"
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!resetting) return
                void onConsumeReset(resetting.account, {
                  idempotencyKey: resetting.key,
                  creditId: resetting.credit.id,
                })
                  .then(() => setResetting(null))
                  .catch(() => undefined)
              }}
            >
              {t("确认使用")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
