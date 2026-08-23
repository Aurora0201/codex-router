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
import { RadioGroup } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
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

/**
 * A plain rule rather than the Separator primitive: its `data-vertical:self-stretch`
 * outranks a plain `self-center`, which top-aligns it against its neighbours, and
 * `role="separator"` is noise inside a run of inline metadata.
 */
const RULE = "h-3.5 w-px shrink-0 self-center bg-border"

/**
 * Rows the console can route through sit above rows that need repair. The live
 * account is deliberately not pinned first: the radio already marks it, and
 * re-sorting on selection would make the list jump under the pointer.
 */
function rank(account: AccountView) {
  if (isRoutable(account)) return 0
  if (isDisabled(account)) return 2
  return 1
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
      <Card className="gap-0 py-0 lg:min-h-0 lg:flex-1">
        <div className="flex min-h-13 items-center gap-x-3 gap-y-2 border-b bg-muted/30 px-4 py-2.5 max-sm:flex-wrap sm:px-6">
          <RouteIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0",
              active ? "text-primary" : "text-muted-foreground"
            )}
          />
          {active ? (
            <>
              {/* One non-wrapping group, so the rules never end up stranded at
                  the start or end of a wrapped line. */}
              <div className="flex min-w-0 items-center gap-x-3">
                <span className="shrink-0 text-sm text-muted-foreground">
                  {t("请求经由")}
                </span>
                <span className="truncate font-mono text-sm font-medium">
                  {shortAccountId(active.chatgptAccountId)}
                </span>
                <span aria-hidden="true" className={RULE} />
                <div className="shrink-0">
                  <AccountStatus account={active} />
                </div>
                {activeRemaining !== null ? (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(RULE, "max-sm:hidden")}
                    />
                    <span className="shrink-0 text-xs text-muted-foreground max-sm:hidden">
                      {t("最紧额度剩余 {{value}}%", {
                        value: Math.round(activeRemaining),
                      })}
                    </span>
                  </>
                ) : null}
              </div>
              <Button
                className="ml-auto shrink-0"
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
              {t("尚未选择路由账号 · 请求使用 Codex 当前登录账号透传")}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-2 border-b px-4 py-2.5 sm:flex-row sm:items-center sm:px-6">
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
                className="flex h-10 items-center gap-4 border-b px-4 text-sm font-medium text-foreground sm:px-6"
              >
                <span className="size-4 shrink-0" />
                <span className="size-12 shrink-0" />
                <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,13rem)_minmax(0,9rem)_minmax(0,26rem)_minmax(0,1fr)] gap-x-5">
                  <span>{t("账号")}</span>
                  <span>{t("状态")}</span>
                  <span>{t("剩余额度")}</span>
                  <span />
                </div>
              </div>
            )}
            <ScrollArea className="lg:min-h-0 lg:flex-1">
              <RadioGroup
                className="block"
                aria-label={t("选择路由账号")}
                value={active?.id ?? null}
                onValueChange={(value: unknown) => {
                  const next = accounts.find((item) => item.id === value)
                  if (next && !next.isActive) onSelect(next)
                }}
              >
                {filtered.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    busy={busyId === account.id}
                    now={now}
                    mobile={mobile}
                    onAction={(action) => handleAction(account, action)}
                  />
                ))}
              </RadioGroup>
            </ScrollArea>
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
