import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  ArrowLeftRightIcon,
  GaugeIcon,
  GripVerticalIcon,
  HistoryIcon,
  ListOrderedIcon,
  PlugZapIcon,
  PowerIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
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

/** How long a moved row takes to settle into its new seat. */
const SNAP_MS = 200

/** Why a switch happened, said in the terms of the window that decided it. */
function reasonLabel(entry: SwitchLogEntryView): string {
  if (
    entry.reason === "quota_below_threshold" &&
    entry.evidence?.window === "short"
  ) {
    return "5 小时额度低于阈值"
  }
  return REASON_LABEL[entry.reason]
}

/**
 * A block of related settings. The sheet is the panel, so a section is its one
 * inset: solid fill inside the outline, never an outline inside an outline.
 */
function Section({
  title,
  icon: Icon,
  hint,
  children,
}: {
  title: string
  icon: typeof GaugeIcon
  hint?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl bg-muted p-3">
      <header className="flex h-6 items-center gap-2">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        <h3 className="flex-1 text-sm font-semibold">{title}</h3>
        {hint ? (
          <span className="text-xs text-muted-foreground-subtle">{hint}</span>
        ) : null}
      </header>
      <div className="mt-2">{children}</div>
    </section>
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
    <div className="grid gap-0.5 py-2 first:pt-0 last:pb-0">
      <label className="flex min-h-7 items-center gap-4">
        <span className="flex-1 text-sm font-medium">{title}</span>
        {control}
      </label>
      {hint ? (
        <span className="pr-14 text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  )
}

/** One window's threshold: what it is called, where it sits, and the slider. */
function ThresholdRow({
  title,
  hint,
  value,
  disabled,
  toggle,
  onDrag,
  onCommit,
}: {
  title: string
  hint: string
  value: number
  /** The whole row is off-limits — switching itself is off. */
  disabled: boolean
  /** Present when the window itself can be taken out of the reckoning. */
  toggle?: { checked: boolean; onChange(next: boolean): void }
  onDrag(value: number): void
  onCommit(value: number): void
}) {
  const { t } = useTranslation()
  // The toggle stays reachable while the row is armed, or the window it arms
  // could never be turned back on.
  const sliderDisabled = disabled || (toggle ? !toggle.checked : false)
  return (
    <div className="grid gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-4">
        {toggle ? (
          <label className="flex flex-1 items-center gap-2">
            <Switch
              size="sm"
              checked={toggle.checked}
              disabled={disabled}
              onCheckedChange={toggle.onChange}
            />
            <span className="text-sm font-medium">{title}</span>
          </label>
        ) : (
          <span className="flex-1 text-sm font-medium">{title}</span>
        )}
        <span className="text-sm font-medium tabular-nums">
          {t("低于 {{value}}%", { value })}
        </span>
      </div>
      <Slider
        min={5}
        max={60}
        step={5}
        value={value}
        disabled={sliderDisabled}
        onValueChange={onDrag}
        onValueCommitted={onCommit}
        label={title}
      />
      <span className="text-xs text-muted-foreground">{hint}</span>
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
  const weekly = accountWindowSlots(account)[0]
  const remaining = weekly ? remainingPercent(weekly) : null
  return (
    <li
      draggable={!disabled}
      data-slot="auto-switch-row"
      data-account-id={account.id}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className={cn(
        // A tile on the inset, which returns to the outer surface: out, in, out.
        "flex items-center gap-3 rounded-lg bg-card px-2.5 py-2",
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
        !enrolled && "opacity-55"
      )}
    >
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground-subtle">
        <GripVerticalIcon aria-hidden="true" className="size-4" />
        <span className="w-3 text-center text-xs font-semibold tabular-nums">
          {seat}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {shortAccountId(account.chatgptAccountId)}
          </span>
          {account.planType ? (
            <span className="shrink-0 rounded bg-muted px-1.5 text-xs font-medium text-muted-foreground uppercase">
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

  // FLIP: where each row sat before the order changed, so it can be played
  // back from there into its new seat instead of teleporting.
  const listRef = useRef<HTMLOListElement>(null)
  const seatsRef = useRef<Map<string, number>>(new Map())
  const readSeats = () => {
    const seats = new Map<string, number>()
    listRef.current
      ?.querySelectorAll<HTMLElement>("[data-account-id]")
      .forEach((row) => seats.set(row.dataset.accountId!, row.offsetTop))
    seatsRef.current = seats
  }
  useLayoutEffect(() => {
    const before = seatsRef.current
    seatsRef.current = new Map()
    if (before.size === 0 || !listRef.current) return
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    listRef.current
      .querySelectorAll<HTMLElement>("[data-account-id]")
      .forEach((row) => {
        const delta = (before.get(row.dataset.accountId!) ?? 0) - row.offsetTop
        if (delta === 0) return
        row.animate?.(
          [
            { transform: `translateY(${delta}px)` },
            { transform: "translateY(0)" },
          ],
          { duration: SNAP_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" }
        )
      })
  }, [order])

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

  /** Local only: what the slider shows while the thumb is still moving. */
  const draft = (values: Partial<AutoSwitchSettingsView>) =>
    setState((current) =>
      current
        ? { ...current, settings: { ...current.settings, ...values } }
        : current
    )

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
    readSeats()
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
      <SheetContent className="w-full sm:max-w-xl">
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
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-6">
            <Section title={t("运行方式")} icon={PowerIcon}>
              <div className="grid divide-y divide-border">
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
              </div>
            </Section>

            <Section title={t("切换阈值")} icon={GaugeIcon}>
              <div className="grid divide-y divide-border">
                <ThresholdRow
                  title={t("周额度")}
                  hint={t("长窗口决定这一周还剩多少。")}
                  value={settings.thresholdPercent}
                  disabled={!on}
                  onDrag={(value) => draft({ thresholdPercent: value })}
                  onCommit={(value) => patch({ thresholdPercent: value })}
                />
                <ThresholdRow
                  title={t("5 小时额度")}
                  hint={t("短窗口才是挡住下一个请求的那个，通常设得更紧。")}
                  value={settings.shortThresholdPercent}
                  disabled={!on}
                  toggle={{
                    checked: settings.watchShortWindow,
                    onChange: (value) => patch({ watchShortWindow: value }),
                  }}
                  onDrag={(value) => draft({ shortThresholdPercent: value })}
                  onCommit={(value) => patch({ shortThresholdPercent: value })}
                />
              </div>
            </Section>

            <Section
              title={t("优先级")}
              icon={ListOrderedIcon}
              hint={t("拖动排序")}
            >
              <ol ref={listRef} className="grid gap-1.5">
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

            <Section title={t("触发与节奏")} icon={SlidersHorizontalIcon}>
              <div className="grid divide-y divide-border">
                <SettingRow
                  title={t("上游返回 429")}
                  control={
                    <Switch
                      checked={settings.triggerOn429}
                      disabled={!on}
                      onCheckedChange={(value) =>
                        patch({ triggerOn429: value })
                      }
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
                      <SelectTrigger
                        className="w-32"
                        aria-label={t("最短驻留")}
                      >
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
                        value &&
                        patch({ onAllBelow: value as AllBelowBehaviour })
                      }
                    >
                      <SelectTrigger
                        className="w-40"
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
              </div>
            </Section>

            <Section title={t("切换记录")} icon={HistoryIcon}>
              {state && state.recent.length > 0 ? (
                <ul className="grid divide-y divide-border">
                  {state.recent.map((entry) => (
                    <li
                      key={entry.id}
                      className="grid grid-cols-[5.5rem_1fr] gap-3 py-1.5 first:pt-0 last:pb-0"
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
                          {t(reasonLabel(entry))}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-1 text-xs text-muted-foreground">
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
