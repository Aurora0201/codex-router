import { useMemo, useState } from "react"
import { ChevronRightIcon, SearchXIcon, TicketCheckIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { AccountActions } from "./account-actions"
import { AccountStatus } from "./account-status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { formatRelativeTime, shortAccountId } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AccountView, RateLimitResetCreditView, UsageWindowView } from "@/services/contracts"

type AccountAction = "copy" | "limits" | "auth" | "subscription" | "toggle" | "remove"
type AccountFilter = "all" | "routable" | "attention" | "disabled"

const isDisabled = (a: AccountView) => !a.enabled || a.auth.status === "disabled"
const isRoutable = (a: AccountView) => a.enabled && a.auth.status === "ready"
const needsAttention = (a: AccountView, now: number) => !isDisabled(a) && (!isRoutable(a) || a.subscription.source === "legacy_estimate" || (a.subscription.expiresAt !== null && a.subscription.expiresAt - now <= 7 * 24 * 60 * 60_000))

function formatDate(value: number | null) {
  return value === null ? "—" : new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "UTC" }).format(value)
}

function windowLabel(window: UsageWindowView, t: (key: string, values?: Record<string, unknown>) => string) {
  const mins = window.windowDurationMins
  if (mins === null) return t("额度窗口")
  if (mins >= 10080 && mins % 10080 === 0) return mins === 10080 ? t("周额度") : t("{{count}} 周额度", { count: mins / 10080 })
  if (mins >= 1440 && mins % 1440 === 0) return t("{{count}} 天额度", { count: mins / 1440 })
  if (mins >= 60 && mins % 60 === 0) return t("{{count}} 小时额度", { count: mins / 60 })
  return t("{{count}} 分钟额度", { count: mins })
}

function sortedWindows(account: AccountView) {
  const bucket = account.limits.buckets.find((b) => b.key === account.limits.defaultBucketKey) ?? account.limits.buckets[0]
  const values = bucket ? [bucket.primary, bucket.secondary].filter((v): v is UsageWindowView => v !== null).sort((a, b) => (b.windowDurationMins ?? 0) - (a.windowDurationMins ?? 0)) : []
  return { bucket, values }
}

function UsageBar({ window }: { window: UsageWindowView }) {
  const { t } = useTranslation()
  const remaining = window.usedPercent === null ? null : Math.max(0, 100 - window.usedPercent)
  return <div className="space-y-2">
    <div className="flex justify-between gap-3 text-sm"><span>{windowLabel(window, t)}</span><span className="font-mono tabular-nums">{remaining === null ? t("未知") : t("剩余 {{value}}%", { value: Math.round(remaining) })}</span></div>
    <Progress value={window.usedPercent ?? 0} aria-label={windowLabel(window, t)} />
    <div className="flex justify-between gap-3 text-xs text-muted-foreground"><span>{t("已用 {{value}}%", { value: window.usedPercent === null ? "—" : Math.round(window.usedPercent) })}</span><span>{window.resetsAt ? t("{{time}}重置", { time: formatRelativeTime(window.resetsAt) }) : t("重置时间未知")}</span></div>
  </div>
}

export function AccountList({ accounts, busyId, onAction, onSelect, onConsumeReset }: {
  accounts: AccountView[]
  busyId: string | null
  onSelect(account: AccountView): void
  onAction(account: AccountView, action: AccountAction): void
  onConsumeReset(account: AccountView, input: { idempotencyKey: string; creditId?: string }): Promise<void>
}) {
  const { t } = useTranslation()
  const [now] = useState(Date.now)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<AccountFilter>("all")
  const [detail, setDetail] = useState<AccountView | null>(null)
  const [resetting, setResetting] = useState<{ account: AccountView; credit: RateLimitResetCreditView; key: string } | null>(null)
  const counts = useMemo(() => ({ routable: accounts.filter(isRoutable).length, attention: accounts.filter((a) => needsAttention(a, now)).length, disabled: accounts.filter(isDisabled).length }), [accounts, now])
  const normalized = query.trim().toLowerCase()
  const filtered = useMemo(() => accounts.filter((a) => {
    const text = !normalized || a.email?.toLowerCase().includes(normalized) || a.chatgptAccountId?.toLowerCase().includes(normalized)
    const state = filter === "all" || (filter === "routable" && isRoutable(a)) || (filter === "attention" && needsAttention(a, now)) || (filter === "disabled" && isDisabled(a))
    return Boolean(text && state)
  }).map((account, index) => ({ account, index })).sort((a, b) => {
    const rank = (x: AccountView) => x.isActive ? 0 : needsAttention(x, now) ? 1 : isRoutable(x) ? 2 : 3
    return rank(a.account) - rank(b.account) || a.index - b.index
  }).map(({ account }) => account), [accounts, filter, normalized, now])
  const active = accounts.find((a) => a.isActive)

  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {[[t("当前路由账号"), active ? shortAccountId(active.chatgptAccountId) : t("未选择")], [t("账号总数"), accounts.length], [t("可路由"), counts.routable], [t("需处理"), counts.attention], [t("已停用"), counts.disabled]].map(([label, value]) =>
        <Card key={String(label)} className="h-full"><CardContent className="p-4"><span className="block text-xs text-muted-foreground">{label}</span><span className="mt-1 block truncate font-mono text-lg font-semibold tabular-nums">{value}</span></CardContent></Card>)}
    </div>
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("搜索授权账号")} placeholder={t("搜索 Account ID 或邮箱")} className="sm:max-w-sm" />
      <Select value={filter} onValueChange={(value) => value && setFilter(value)}><SelectTrigger aria-label={t("筛选账号状态")} className="w-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent align="start">
        <SelectItem value="all">{t("全部（{{count}}）", { count: accounts.length })}</SelectItem><SelectItem value="routable">{t("可路由（{{count}}）", { count: counts.routable })}</SelectItem><SelectItem value="attention">{t("需处理（{{count}}）", { count: counts.attention })}</SelectItem><SelectItem value="disabled">{t("已停用（{{count}}）", { count: counts.disabled })}</SelectItem>
      </SelectContent></Select>
      <span className="text-xs text-muted-foreground sm:ml-auto">{t("显示 {{shown}} / 共 {{total}}", { shown: filtered.length, total: accounts.length })}</span>
    </div>

    {filtered.length ? <div className="grid items-stretch gap-4 md:grid-cols-2 2xl:grid-cols-3">{filtered.map((account) => {
      const usage = sortedWindows(account)
      const expired = account.subscription.expiresAt !== null && account.subscription.expiresAt < now
      const expiresSoon = account.subscription.expiresAt !== null && account.subscription.expiresAt >= now && account.subscription.expiresAt - now <= 7 * 24 * 60 * 60_000
      return <Card key={account.id} className={cn("h-full min-h-0", account.isActive && "border-primary/50")}>
        <CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0">
          <Tooltip><TooltipTrigger render={<CardTitle className="truncate font-mono text-base" />}>{account.email ?? shortAccountId(account.chatgptAccountId)}</TooltipTrigger><TooltipContent>{account.email ?? account.chatgptAccountId}</TooltipContent></Tooltip>
          <CardDescription className="mt-1 truncate font-mono">{shortAccountId(account.chatgptAccountId)}</CardDescription>
        </div><AccountActions account={account} disabled={busyId === account.id} onAction={(action) => onAction(account, action)} /></div>
          <div className="flex flex-wrap gap-2 pt-2">{account.isActive ? <Badge>{t("当前路由")}</Badge> : null}<AccountStatus account={account} />{account.auth.stale ? <Badge variant="outline">{t("数据已陈旧")}</Badge> : null}</div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-muted-foreground">{t("订阅等级")}</dt><dd className="mt-1 font-mono">{account.planType ?? t("未知")}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("认证模式")}</dt><dd className="mt-1 font-mono">{account.auth.mode ?? t("未知")}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("最近验证")}</dt><dd className="mt-1">{formatRelativeTime(account.auth.lastSuccessfulAt)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">{t("订阅到期")}</dt><dd className={cn("mt-1", expired && "text-destructive")}>{formatDate(account.subscription.expiresAt)} {account.subscription.source === "legacy_estimate" ? <span className="text-xs text-warning">{t("待确认")}</span> : expired ? <span className="text-xs text-destructive">{t("已过期")}</span> : expiresSoon ? <span className="text-xs text-warning">{t("即将到期")}</span> : null}</dd></div>
          </dl>
          <div className="flex-1 space-y-4 rounded-lg border bg-muted/20 p-3">{usage.values.length ? usage.values.slice(0, 2).map((w, i) => <UsageBar key={String(w.windowDurationMins) + String(i)} window={w} />) : <p className="py-5 text-center text-sm text-muted-foreground">{t("额度数据暂不可用")}</p>}</div>
          <div className="flex justify-between gap-3 text-xs text-muted-foreground"><span>{usage.bucket?.credits?.unlimited ? t("Credits：无限") : usage.bucket?.credits?.balance ? t("Credits：{{balance}}", { balance: usage.bucket.credits.balance }) : usage.bucket?.individualLimit ? t("月度剩余 {{value}}%", { value: usage.bucket.individualLimit.remainingPercent }) : t("无额外额度")}</span><span>{formatRelativeTime(account.limits.checkedAt)}</span></div>
          <div className="grid grid-cols-[1fr_auto] gap-2"><Button disabled={busyId !== null || !isRoutable(account) || account.isActive} onClick={() => onSelect(account)}>{account.isActive ? t("已是当前路由") : t("设为当前路由")}</Button><Button variant="outline" size="icon" onClick={() => setDetail(account)}><ChevronRightIcon /><span className="sr-only">{t("查看账号详情")}</span></Button></div>
        </CardContent>
      </Card>
    })}</div> : <Empty className="rounded-xl border py-12"><EmptyHeader><EmptyMedia variant="icon"><SearchXIcon /></EmptyMedia><EmptyTitle>{t("没有匹配的账号")}</EmptyTitle><EmptyDescription>{t("调整搜索内容或状态筛选后再试。")}</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline" onClick={() => { setQuery(""); setFilter("all") }}>{t("清除筛选")}</Button></EmptyContent></Empty>}

    <Sheet open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}><SheetContent className="w-full sm:max-w-lg"><SheetHeader><SheetTitle>{t("账号详情")}</SheetTitle><SheetDescription>{detail?.email ?? shortAccountId(detail?.chatgptAccountId ?? null)}</SheetDescription></SheetHeader>
      {detail ? <ScrollArea className="min-h-0 flex-1"><div className="space-y-6 px-4 pb-6">
        <section className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm"><div><p className="text-xs text-muted-foreground">{t("认证模式")}</p><p className="mt-1 font-mono">{detail.auth.mode ?? t("未知")}</p></div><div><p className="text-xs text-muted-foreground">{t("最近成功")}</p><p className="mt-1">{formatRelativeTime(detail.auth.lastSuccessfulAt)}</p></div></section>
        <section className="space-y-3"><h3 className="font-heading font-medium">{t("全部额度窗口")}</h3>{detail.limits.buckets.length ? detail.limits.buckets.map((bucket) =>
          <div key={bucket.key} className="space-y-4 rounded-lg border p-3"><div className="flex justify-between gap-3"><p className="truncate font-medium">{bucket.limitName ?? bucket.key}</p>{bucket.spendControlReached ? <Badge variant="destructive">{t("额度已耗尽")}</Badge> : null}</div>
            {[bucket.primary, bucket.secondary].filter((w): w is UsageWindowView => w !== null).sort((a, b) => (b.windowDurationMins ?? 0) - (a.windowDurationMins ?? 0)).map((w, i) => <UsageBar key={String(w.windowDurationMins) + String(i)} window={w} />)}
            {bucket.credits ? <p className="text-sm text-muted-foreground">{bucket.credits.unlimited ? t("Credits：无限") : t("Credits 余额：{{balance}}", { balance: bucket.credits.balance ?? "—" })}</p> : null}
            {bucket.individualLimit ? <div><div className="mb-2 flex justify-between text-sm"><span>{t("个人月度限制")}</span><span className="font-mono">{bucket.individualLimit.remainingPercent}%</span></div><Progress value={100 - bucket.individualLimit.remainingPercent} /></div> : null}
          </div>) : <p className="text-sm text-muted-foreground">{t("额度数据暂不可用")}</p>}</section>
        <section className="space-y-3"><h3 className="font-heading font-medium">{t("额度重置券")}</h3>{detail.limits.resetCredits?.credits?.length ? [...detail.limits.resetCredits.credits].sort((a, b) => (a.expiresAt ?? Number.MAX_SAFE_INTEGER) - (b.expiresAt ?? Number.MAX_SAFE_INTEGER)).map((credit) =>
          <div key={credit.id} className="rounded-lg border p-3"><div className="flex justify-between gap-3"><div><p className="font-medium">{credit.title ?? t("额度重置券")}</p><p className="mt-1 text-xs text-muted-foreground">{credit.expiresAt ? t("有效期至 {{date}}", { date: formatDate(credit.expiresAt) }) : t("无到期时间")}</p></div><Badge variant="outline">{credit.status}</Badge></div>{credit.status === "available" ? <Button className="mt-3 w-full" variant="outline" onClick={() => setResetting({ account: detail, credit, key: crypto.randomUUID() })}><TicketCheckIcon data-icon="inline-start" />{t("使用重置券")}</Button> : null}</div>) : <p className="text-sm text-muted-foreground">{t("当前没有重置券")}</p>}</section>
      </div></ScrollArea> : null}
    </SheetContent></Sheet>

    <AlertDialog open={resetting !== null} onOpenChange={(open) => !open && setResetting(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t("使用额度重置券？")}</AlertDialogTitle><AlertDialogDescription>{t("此操作会立即尝试重置服务端额度。结果以 Codex 返回为准，客户端不会自行推断额度变化。")}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t("取消")}</AlertDialogCancel><AlertDialogAction onClick={() => { if (resetting) void onConsumeReset(resetting.account, { idempotencyKey: resetting.key, creditId: resetting.credit.id }).then(() => setResetting(null)).catch(() => undefined) }}>{t("确认使用")}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
