import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowLeftRightIcon, GripVerticalIcon, PlugZapIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { accountWindowSlots, remainingPercent } from "@/lib/account-state"
import { formatRelativeTime, shortAccountId } from "@/lib/format"
import { cn } from "@/lib/utils"
import type {
  AccountView,
  AllBelowBehaviour,
  AutoSwitchSettingsView,
  AutoSwitchView,
  GatewayService,
  SwitchLogEntryView,
} from "@/services/contracts"

const DWELL_CHOICES = [60_000, 5 * 60_000, 15 * 60_000] as const

const ALL_BELOW_LABEL: Record<AllBelowBehaviour, string> = {
  highest: "留在剩余最多的",
  stay: "留在当前",
  pause: "暂停并提示",
}

const REASON_LABEL: Record<SwitchLogEntryView["reason"], string> = {
  quota_below_threshold: "周额度低于阈值",
  upstream_rate_limited: "上游返回 429",
  account_unavailable: "账号不可用",
  higher_priority_recovered: "更高优先级恢复",
}

/** What the gateway ranks on: the long window's headroom, or nothing read yet. */
function weeklyRemaining(account: AccountView): number | null {
  const weekly = accountWindowSlots(account)[0]
  return weekly ? remainingPercent(weekly) : null
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <span className="text-xs text-muted-foreground-subtle">{title}</span>
      {children}
    </div>
  )
}

/**
 * One setting on a line. The label wraps the control so its own text is the
 * accessible name; the hint sits outside it, where it explains without becoming
 * part of what the control is called.
 */
function SettingRow({
  title,
  hint,
  control,
}: {
  title: string
  hint?: string
  control: ReactNode
}) {
  return (
    <div className="grid gap-0.5">
      <label className="flex items-center gap-3">
        <span className="flex-1 text-sm font-medium">{title}</span>
        {control}
      </label>
      {hint ? (
        <span className="pr-11 text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  )
}

function PriorityRow({
  account,
  seat,
  live,
  enrolled,
  dragging,
  disabled,
  onToggle,
  onDragStart,
  onDragEnter,
  onDrop,
}: {
  account: AccountView
  seat: number
  live: boolean
  enrolled: boolean
  dragging: boolean
  disabled: boolean
  onToggle(next: boolean): void
  onDragStart(): void
  onDragEnter(): void
  onDrop(): void
}) {
  const { t } = useTranslation()
  const remaining = weeklyRemaining(account)
  return (
    <li
      draggable={!disabled}
      data-slot="auto-switch-row"
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className={cn(
        "flex items-center gap-2 rounded-xl bg-muted px-2 py-1.5",
        disabled ? "cursor-default" : "cursor-grab",
        dragging && "opacity-40",
        !enrolled && "opacity-55"
      )}
    >
      <GripVerticalIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground-subtle"
      />
      <span className="w-4 shrink-0 text-center text-xs font-semibold text-muted-foreground-subtle tabular-nums">
        {seat}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {shortAccountId(account.chatgptAccountId)}
          </span>
          {account.planType ? (
            <span className="shrink-0 rounded bg-card px-1 text-xs font-medium text-muted-foreground uppercase">
              {account.planType}
            </span>
          ) : null}
          {live ? (
            <span className="shrink-0 rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
              {t("使用中")}
            </span>
          ) : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground-subtle">
          {account.email ?? t("未报告邮箱")}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold tabular-nums">
          {remaining === null
            ? "—"
            : t("{{value}}%", { value: Math.round(remaining) })}
        </span>
        <span className="block text-xs text-muted-foreground-subtle">
          {t("周额度")}
        </span>
      </span>
      <Switch
        checked={enrolled}
        disabled={disabled}
        onCheckedChange={onToggle}
        aria-label={t("{{account}} 参与自动切换", {
          account: shortAccountId(account.chatgptAccountId),
        })}
      />
    </li>
  )
}

/**
 * The route band's entry to auto switching: a button that says whether it is
 * armed, and the sheet holding everything behind it.
 */
export function AutoSwitchButton({
  accounts,
  activeAccountId,
  service,
  disabled,
}: {
  accounts: AccountView[]
  activeAccountId: string | null
  service: GatewayService
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<AutoSwitchView | null>(null)
  const [order, setOrder] = useState<string[]>([])
  const [enrolled, setEnrolled] = useState<Record<string, boolean>>({})
  const [dragId, setDragId] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  // The pool as it stood when the sheet opened. Reading it through a ref keeps
  // a routine snapshot reload from re-seating the list under a hand mid-drag.
  const accountsRef = useRef(accounts)
  useEffect(() => {
    accountsRef.current = accounts
  }, [accounts])

  // Read once so the button can say whether switching is armed, and again on
  // every open so the ranking and the log are the gateway's, not a stale copy.
  useEffect(() => {
    let cancelled = false
    void service
      .getAutoSwitch()
      .then((next) => {
        if (cancelled) return
        setFailure(null)
        setState(next)
        // The gateway's own candidate order leads; the accounts it left out
        // still need a seat, so they can be dragged back into the rotation.
        const rest = accountsRef.current
          .map((account) => account.id)
          .filter((id) => !next.candidateIds.includes(id))
        setOrder([...next.candidateIds, ...rest])
        setEnrolled(
          Object.fromEntries(
            accountsRef.current.map((account) => [
              account.id,
              next.candidateIds.includes(account.id),
            ])
          )
        )
      })
      // Said inside the sheet rather than as a toast: this read also runs in
      // the background, and a gateway too old to know the route would greet
      // every page load with an error nobody asked for.
      .catch((error: Error) => {
        if (!cancelled) setFailure(error.message)
      })
    return () => {
      cancelled = true
    }
  }, [open, service, attempt])

  const byId = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts]
  )
  const settings = state?.settings ?? null
  const on = settings?.enabled ?? false

  const patch = (values: Partial<AutoSwitchSettingsView>) => {
    setState((current) =>
      current
        ? { ...current, settings: { ...current.settings, ...values } }
        : current
    )
    void service.saveAutoSwitch(values).catch((error: Error) =>
      toast.add({
        title: t("保存失败"),
        description: error.message,
        type: "error",
      })
    )
  }

  const persistPriority = (
    nextOrder: string[],
    nextEnrolled: Record<string, boolean>
  ) => {
    void service
      .saveAutoSwitchPriority({ order: nextOrder, enrolled: nextEnrolled })
      .catch((error: Error) =>
        toast.add({
          title: t("保存优先级失败"),
          description: error.message,
          type: "error",
        })
      )
  }

  // Moved as the pointer crosses a row, so the list reads as it will end up;
  // written once on drop rather than on every row it passes over.
  const reorder = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    setOrder((current) => {
      const next = [...current]
      next.splice(
        next.indexOf(targetId),
        0,
        ...next.splice(next.indexOf(dragId), 1)
      )
      return next
    })
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="sm" disabled={disabled}>
            <ArrowLeftRightIcon aria-hidden="true" data-icon="inline-start" />
            {/* Whether it is armed is said in words. Green is not one of the
                four status tones, and off is the default, which wears none. */}
            {!on
              ? t("自动切换")
              : settings?.dryRun
                ? t("自动切换 · 试运行")
                : t("自动切换 · 已开")}
          </Button>
        }
      />
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("自动切换")}</SheetTitle>
          <SheetDescription>
            {failure !== null
              ? t("读不到自动切换设置。")
              : !on
                ? t("关闭时一切照旧，路由只跟随你手动的选择。")
                : settings?.dryRun
                  ? t("试运行中 · 只记录，不切换")
                  : t("已启用 · 会自动切换")}
          </SheetDescription>
        </SheetHeader>

        {failure !== null ? (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PlugZapIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>{t("网关没有回应这个设置")}</EmptyTitle>
              <EmptyDescription>
                {/* The one cause worth naming: the console ships with the
                    gateway, so a 404 here means the running gateway predates
                    this page. */}
                {t(
                  "多半是正在运行的网关还是旧版本，重启一次网关就会带上这个接口。"
                )}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <p className="text-xs text-muted-foreground-subtle">{failure}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAttempt((n) => n + 1)}
              >
                {t("重试")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : settings === null ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t("正在载入…")}
          </p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6">
            <SettingRow
              title={t("额度不足时自动换账号")}
              hint={t("按下面的顺序换到下一个够用的账号。")}
              control={
                <Switch
                  checked={settings.enabled}
                  onCheckedChange={(value) => patch({ enabled: value })}
                />
              }
            />

            <SettingRow
              title={t("先试运行")}
              hint={t("只记录本来会切的时刻，不真的切换。")}
              control={
                <Switch
                  checked={settings.dryRun}
                  disabled={!on}
                  onCheckedChange={(value) => patch({ dryRun: value })}
                />
              }
            />

            <Section title={t("优先级 · 拖动排序")}>
              <ol className="grid gap-1.5">
                {order.map((id, index) => {
                  const account = byId.get(id)
                  if (!account) return null
                  return (
                    <PriorityRow
                      key={id}
                      account={account}
                      seat={index + 1}
                      live={id === activeAccountId}
                      enrolled={enrolled[id] ?? false}
                      dragging={dragId === id}
                      disabled={!on}
                      onToggle={(next) => {
                        const merged = { ...enrolled, [id]: next }
                        setEnrolled(merged)
                        persistPriority(order, merged)
                      }}
                      onDragStart={() => setDragId(id)}
                      onDragEnter={() => reorder(id)}
                      onDrop={() => {
                        setDragId(null)
                        persistPriority(order, enrolled)
                      }}
                    />
                  )
                })}
              </ol>
            </Section>

            <div className="grid gap-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground-subtle">
                  {t("切换阈值")}
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {t("周额度低于 {{value}}%", {
                    value: settings.thresholdPercent,
                  })}
                </span>
              </div>
              <Slider
                min={5}
                max={60}
                step={5}
                disabled={!on}
                value={settings.thresholdPercent}
                // Local while the thumb moves, saved once it is let go.
                onValueChange={(value) =>
                  setState((current) =>
                    current
                      ? {
                          ...current,
                          settings: {
                            ...current.settings,
                            thresholdPercent: value,
                          },
                        }
                      : current
                  )
                }
                onValueCommitted={(value) => patch({ thresholdPercent: value })}
                aria-label={t("切换阈值")}
              />
            </div>

            <Section title={t("还有这些情况也切")}>
              <SettingRow
                title={t("上游返回 429")}
                control={
                  <Switch
                    checked={settings.triggerOn429}
                    disabled={!on}
                    onCheckedChange={(value) => patch({ triggerOn429: value })}
                  />
                }
              />
              <SettingRow
                title={t("认证失效或账号停用")}
                control={
                  <Switch
                    checked={settings.triggerOnAuthFailure}
                    disabled={!on}
                    onCheckedChange={(value) =>
                      patch({ triggerOnAuthFailure: value })
                    }
                  />
                }
              />
            </Section>

            <Section title={t("节奏与兜底")}>
              <SettingRow
                title={t("最短驻留")}
                hint={t("防止在阈值附近来回横跳。")}
                control={
                  <Select
                    value={String(settings.minDwellMs)}
                    disabled={!on}
                    onValueChange={(value) =>
                      value && patch({ minDwellMs: Number(value) })
                    }
                  >
                    <SelectTrigger className="w-28" aria-label={t("最短驻留")}>
                      <SelectValue>
                        {t("{{count}} 分钟", {
                          count: settings.minDwellMs / 60_000,
                        })}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {DWELL_CHOICES.map((ms) => (
                          <SelectItem key={ms} value={String(ms)}>
                            {t("{{count}} 分钟", { count: ms / 60_000 })}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                }
              />
              <SettingRow
                title={t("恢复后切回更高优先级")}
                control={
                  <Switch
                    checked={settings.switchBackToHigherPriority}
                    disabled={!on}
                    onCheckedChange={(value) =>
                      patch({ switchBackToHigherPriority: value })
                    }
                  />
                }
              />
              <SettingRow
                title={t("全部低于阈值时")}
                control={
                  <Select
                    value={settings.onAllBelow}
                    disabled={!on}
                    onValueChange={(value) =>
                      value && patch({ onAllBelow: value as AllBelowBehaviour })
                    }
                  >
                    <SelectTrigger
                      className="w-36"
                      aria-label={t("全部低于阈值时")}
                    >
                      <SelectValue>
                        {t(ALL_BELOW_LABEL[settings.onAllBelow])}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {(
                          Object.keys(ALL_BELOW_LABEL) as AllBelowBehaviour[]
                        ).map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(ALL_BELOW_LABEL[value])}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                }
              />
            </Section>

            <Section title={t("切换记录")}>
              {state && state.recent.length > 0 ? (
                <ul className="grid">
                  {state.recent.map((entry) => (
                    <li
                      key={entry.id}
                      className="grid grid-cols-[5rem_1fr] gap-3 border-t border-border py-1.5 first:border-t-0"
                    >
                      <span className="text-xs text-muted-foreground-subtle tabular-nums">
                        {formatRelativeTime(entry.switchedAt)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm">
                          {entry.dryRun
                            ? t("未切换")
                            : t("切到 {{account}}", {
                                account: shortAccountId(
                                  byId.get(entry.toAccountId ?? "")
                                    ?.chatgptAccountId ?? entry.toAccountId
                                ),
                              })}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {t(REASON_LABEL[entry.reason])}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-2 text-xs text-muted-foreground">
                  {t("还没有切换记录")}
                </p>
              )}
            </Section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
