import { useEffect, useMemo, useRef, useState } from "react"
import { RouteIcon, RouteOffIcon, SearchIcon, SearchXIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { AccountCard } from "./account-card"
import { AccountDetailSheet } from "./account-detail-sheet"
import { AccountStatus } from "./account-status-badge"
import type { AccountAction } from "./account-actions"
import { Button } from "@/components/ui/button"
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
import { RadioGroup } from "@/components/ui/radio-group"
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

const PANEL = "rounded-2xl bg-card p-2 ring-1 ring-foreground/10"

/** Fades hint that the grid runs past the edge of its own scroll area. */
function readFades(el: HTMLElement) {
  return {
    top: el.scrollTop > 1,
    bottom: el.scrollTop < el.scrollHeight - el.clientHeight - 1,
  }
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
  const [now] = useState(Date.now)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<AccountFilter>("all")
  const [detail, setDetail] = useState<AccountView | null>(null)
  const [resetting, setResetting] = useState<{
    account: AccountView
    credit: RateLimitResetCreditView
    key: string
  } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [fades, setFades] = useState({ top: false, bottom: false })
  // The grid's own height decides this, so remeasure when it changes as well as
  // on scroll.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setFades(readFades(el))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
  }, [])

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
  // Filtered but never re-sorted. The server returns accounts by creation date,
  // which is the one order that does not move: ranking by status or by
  // remaining quota reshuffled the grid every time an account was used.
  const filtered = useMemo(
    () =>
      accounts.filter((account) => {
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
      }),
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
      <section className={cn("shrink-0", PANEL)}>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-primary/8 p-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-card text-primary">
              <RouteIcon aria-hidden="true" className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground/70">
                {t("当前请求路由")}
              </p>
              <p
                className={cn(
                  "truncate text-sm font-semibold",
                  active ? "font-mono" : "font-normal text-muted-foreground"
                )}
              >
                {active
                  ? shortAccountId(active.chatgptAccountId)
                  : t("尚未选择路由账号 · 请求使用 Codex 当前登录账号透传")}
              </p>
            </div>
          </div>
          {active ? (
            <div className="flex items-center gap-5 text-right text-xs">
              <div>
                <p className="text-muted-foreground/70">{t("认证状态")}</p>
                <div className="mt-0.5 flex justify-end">
                  <AccountStatus account={active} />
                </div>
              </div>
              <div>
                <p className="text-muted-foreground/70">{t("紧要额度")}</p>
                <p className="mt-0.5 font-medium tabular-nums">
                  {activeRemaining === null
                    ? t("未报告")
                    : t("{{value}}%", { value: Math.round(activeRemaining) })}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busyId !== null}
                onClick={onClearRoute}
              >
                <RouteOffIcon data-icon="inline-start" />
                {t("清除路由")}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <section
        className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", PANEL)}
      >
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 p-2">
          <label className="flex h-9 w-full items-center gap-2 rounded-xl bg-muted px-3 text-muted-foreground sm:w-80">
            <SearchIcon aria-hidden="true" className="size-4 shrink-0" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t("搜索授权账号")}
              placeholder={t("搜索 Account ID 或邮箱")}
            />
          </label>

          <div className="flex rounded-xl bg-muted p-1">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                aria-label={t("{{label}}（{{count}}）", {
                  label: option.label,
                  count: option.count,
                })}
                onClick={() => setFilter(option.value)}
                className={cn(
                  "h-7 cursor-pointer rounded-lg px-2.5 text-xs font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  filter === option.value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span aria-hidden="true">{option.label}</span>{" "}
                <span aria-hidden="true" className="tabular-nums opacity-60">
                  {option.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={(event) => setFades(readFades(event.currentTarget))}
            className="subtle-scrollbar h-full overflow-y-auto"
          >
            {filtered.length ? (
              <RadioGroup
                className="grid gap-3 p-2 pt-1 pb-4 md:grid-cols-2 xl:grid-cols-3"
                aria-label={t("选择路由账号")}
                value={active?.id ?? null}
                onValueChange={(value: unknown) => {
                  const next = accounts.find((item) => item.id === value)
                  if (next && !next.isActive) onSelect(next)
                }}
              >
                {filtered.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    busy={busyId === account.id}
                    now={now}
                    onAction={(action) => handleAction(account, action)}
                  />
                ))}
              </RadioGroup>
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
          </div>

          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 h-6 bg-linear-to-b from-card to-transparent transition-opacity duration-150",
              fades.top ? "opacity-100" : "opacity-0"
            )}
          />
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-linear-to-t from-card to-transparent transition-opacity duration-150",
              fades.bottom ? "opacity-100" : "opacity-0"
            )}
          />
        </div>
      </section>

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
