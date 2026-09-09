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
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Section } from "@/components/account/sheet-section"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { toast } from "@/components/ui/toast"
import { accountWindowSlots, remainingPercent } from "@/lib/account-state"
import { formatRelativeTime, shortAccountId } from "@/lib/format"
import { cn } from "@/lib/utils"
import type {
  AccountsResponse,
  AccountView,
  AllBelowBehaviour,
  AutoSwitchSettingsView,
  AutoSwitchView,
  GatewayService,
  SwitchBasis,
  SwitchLogEntryView,
} from "@/services/contracts"

const DWELL_CHOICES = [60_000, 5 * 60_000, 15 * 60_000] as const

const BASIS_LABEL: Record<SwitchBasis, string> = {
  weekly: "周额度",
  short: "5 小时额度",
  both: "两个都看",
}

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
 * One setting on a line, built on `Item`: the title and its hint share the
 * flexible column and clamp rather than push, so a long label wraps the control
 * onto the next line instead of widening the sheet.
 *
 * The control carries its own `aria-label`, which is the title verbatim. A
 * `<label>` around the whole row would hand the control the hint as well, and
 * the name a screen reader reads would be a paragraph.
 */
function SettingRow({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <Item size="xs" className="px-0">
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full">{title}</ItemTitle>
        {hint ? (
          <ItemDescription className="text-xs">{hint}</ItemDescription>
        ) : null}
      </ItemContent>
      {/* A switch is 18px tall and a select is 32; without a floor the rows
          step up and down the list depending on which control they hold. */}
      <ItemActions className="min-h-8">{children}</ItemActions>
    </Item>
  )
}

/** One window's threshold: what it is called, where it sits, and the slider. */
function ThresholdRow({
  title,
  hint,
  value,
  disabled,
  onDrag,
  onCommit,
}: {
  title: string
  hint: string
  value: number
  disabled: boolean
  onDrag(value: number): void
  onCommit(value: number): void
}) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-4">
        <span className="flex-1 text-sm font-medium">{title}</span>
        <span className="text-sm font-medium tabular-nums">
          {t("低于 {{value}}%", { value })}
        </span>
      </div>
      <Slider
        // Inset from the row, so a thumb parked at either end is not sitting
        // against the section's edge.
        className="px-2"
        min={5}
        max={60}
        step={5}
        value={value}
        disabled={disabled}
        onValueChange={onDrag}
        onValueCommitted={onCommit}
        label={title}
      />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}

/** The window the ranking is actually judged on, and what to call it. */
function judgedWindow(account: AccountView, basis: SwitchBasis) {
  const [long, short] = accountWindowSlots(account)
  const weekly = { window: long, label: "周额度" }
  const hourly = { window: short, label: "5 小时额度" }
  if (basis === "weekly") return weekly
  if (basis === "short") return hourly
  // Watching both: show whichever has less left, since that is the one that
  // will trip first.
  const left = (w: typeof long) => (w ? (remainingPercent(w) ?? 101) : 101)
  return left(short) < left(long) ? hourly : weekly
}

function PriorityRow({
  account,
  basis,
  seat,
  live,
  enrolled,
  dragging,
  disabled,
  onToggle,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  account: AccountView
  basis: SwitchBasis
  seat: number
  live: boolean
  enrolled: boolean
  dragging: boolean
  disabled: boolean
  onToggle(next: boolean): void
  onDragStart(): void
  onDragOver(pointerY: number, rect: DOMRect): void
  onDrop(): void
}) {
  const { t } = useTranslation()
  const judged = judgedWindow(account, basis)
  const remaining = judged.window ? remainingPercent(judged.window) : null
  return (
    <li
      draggable={!disabled}
      data-slot="auto-switch-row"
      data-account-id={account.id}
      onDragStart={onDragStart}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver(event.clientY, event.currentTarget.getBoundingClientRect())
      }}
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
          {t(judged.label)}
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
  routing,
  service,
}: {
  /**
   * The accounts and the routed one, exactly as the gateway last reported
   * them. A new object arrives on every gateway tick, and that identity is
   * the beat this button re-reads its own state on — see `beat` below.
   */
  routing: AccountsResponse
  service: GatewayService
}) {
  const { t } = useTranslation()
  const { accounts, activeAccountId } = routing
  const disabled = accounts.length === 0
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

  /**
   * Auto-switch state is not part of the page's snapshot, so nothing else
   * refreshes it. Without a beat the one read at mount is the only one there
   * is, and a read that loses the race with a gateway coming back up leaves
   * the button saying "off" for as long as the page stays open — the only
   * way back was to open the sheet, which reads again.
   *
   * So it re-reads whenever the gateway hands the page a new set of accounts,
   * which also keeps the armed/paused badge honest while the sheet is shut.
   * Not while it is open, though: there its own state leads, and a re-read
   * mid-drag re-seats the list under the hand moving it.
   */
  const beat = open ? null : routing

  // Read on that beat, and again on every open so the ranking and the log are
  // the gateway's rather than a stale copy.
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
  }, [open, service, attempt, beat])

  // FLIP: where each row sat before the order changed, so it can be played
  // back from there into its new seat instead of teleporting.
  const listRef = useRef<HTMLOListElement>(null)
  /** True while rows are still travelling, so no new decision is taken. */
  const settling = useRef(false)
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
    if (before.size === 0 || !listRef.current) {
      settling.current = false
      return
    }
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")
    const flights: Animation[] = []
    listRef.current
      .querySelectorAll<HTMLElement>("[data-account-id]")
      .forEach((row) => {
        // The dragged row is already following the pointer; animating it too
        // would fight the browser's own drag image.
        if (row.dataset.accountId === dragId) return
        const delta = (before.get(row.dataset.accountId!) ?? 0) - row.offsetTop
        if (delta === 0 || reduced?.matches) return
        const flight = row.animate?.(
          [
            { transform: `translateY(${delta}px)` },
            { transform: "translateY(0)" },
          ],
          { duration: SNAP_MS, easing: "cubic-bezier(0.2, 0, 0, 1)" }
        )
        if (flight) flights.push(flight)
      })
    if (flights.length === 0) {
      settling.current = false
      return
    }
    void Promise.allSettled(flights.map((flight) => flight.finished)).then(
      () => {
        settling.current = false
      }
    )
  }, [order, dragId])

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

  /**
   * A row changes places only once the pointer has crossed the middle of the
   * row it is over, in the direction it is travelling. Swapping on entry
   * instead makes the two rows trade seats under a still pointer and then
   * trade back — the list shakes rather than settles.
   *
   * Holding off while rows are still travelling is the other half of it: a row
   * mid-flight measures somewhere between its two seats, so a decision taken
   * then is taken against a position that means nothing.
   */
  const reorder = (targetId: string, pointerY: number, rect: DOMRect) => {
    if (!dragId || dragId === targetId || settling.current) return
    const from = order.indexOf(dragId)
    const to = order.indexOf(targetId)
    if (from < 0 || to < 0) return
    const middle = rect.top + rect.height / 2
    if (to > from ? pointerY < middle : pointerY > middle) return

    readSeats()
    settling.current = true
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
          <Button
            className="h-9 flex-1 rounded-xl sm:flex-none"
            variant="outline"
            disabled={disabled}
          >
            <ArrowLeftRightIcon aria-hidden="true" data-icon="inline-start" />
            {/* Whether it is armed is said in words first. The dot is
                supplemental, and it beats rather than sits still only while
                the router may actually move on its own. */}
            {!on
              ? t("自动切换")
              : state?.stalled
                ? t("自动切换 · 已暂停")
                : t("自动切换 · 已开")}
            {on ? (
              <span
                aria-hidden="true"
                data-icon="inline-end"
                className="relative grid size-2 place-items-center"
              >
                {state?.stalled ? null : (
                  <span className="absolute size-full animate-ping rounded-full bg-primary opacity-60 motion-reduce:hidden" />
                )}
                <span
                  className={cn(
                    "relative size-full rounded-full",
                    state?.stalled ? "bg-warning" : "bg-primary"
                  )}
                />
              </span>
            ) : null}
          </Button>
        }
      />
      {/* SheetContent's own cap is `data-[side=right]:sm:max-w-sm`, and a bare
          `sm:max-w-*` loses to it on specificity — the width has to be set
          through the same variant or it silently stays at 24rem. */}
      <SheetContent className="w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t("自动切换")}</SheetTitle>
          <SheetDescription>
            {failure !== null
              ? t("读不到自动切换设置。")
              : !on
                ? t("关闭时一切照旧，路由只跟随你手动的选择。")
                : state?.stalled
                  ? t("轮换里的账号都低于阈值，暂时无处可切。")
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
          <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]]:scroll-fade">
            <div className="flex flex-col gap-3 px-4 pb-6">
              {/* The master switch is what the other four sections answer to,
                  so it is the section's own heading rather than a lone row
                  inside it — a heading that repeated the row underneath it
                  left the switch centred on the row and 36px of heading
                  stacked above it, which reads as a lopsided box. */}
              <Section
                title={t("额度不足时自动换账号")}
                icon={PowerIcon}
                description={t("按下面的顺序换到下一个够用的账号。")}
                control={
                  <Switch
                    aria-label={t("额度不足时自动换账号")}
                    checked={settings.enabled}
                    onCheckedChange={(value) => patch({ enabled: value })}
                  />
                }
              />

              <Section title={t("按哪个额度切换")} icon={GaugeIcon}>
                {/* A segmented control on the section's own fill: the
                    selected segment returns to the card surface, because the
                    toggle's default pressed state is `bg-muted` — the very
                    colour it is sitting on. */}
                <ToggleGroup
                  className="w-full"
                  size="sm"
                  disabled={!on}
                  value={[settings.switchOn]}
                  onValueChange={(values) => {
                    const next = values[0] as SwitchBasis | undefined
                    // An empty selection would leave nothing deciding, so the
                    // current choice stands until another is picked.
                    if (next) patch({ switchOn: next })
                  }}
                >
                  {(Object.keys(BASIS_LABEL) as SwitchBasis[]).map((basis) => (
                    <ToggleGroupItem
                      key={basis}
                      className="flex-1 hover:bg-card/60 aria-pressed:bg-card aria-pressed:shadow-sm"
                      value={basis}
                    >
                      {t(BASIS_LABEL[basis])}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div className="mt-1 grid divide-y divide-border">
                  {settings.switchOn !== "short" ? (
                    <ThresholdRow
                      title={t("周额度")}
                      hint={t("长窗口决定这一周还剩多少。")}
                      value={settings.thresholdPercent}
                      disabled={!on}
                      onDrag={(value) => draft({ thresholdPercent: value })}
                      onCommit={(value) => patch({ thresholdPercent: value })}
                    />
                  ) : null}
                  {settings.switchOn !== "weekly" ? (
                    <ThresholdRow
                      title={t("5 小时额度")}
                      hint={t("短窗口才是挡住下一个请求的那个，通常设得更紧。")}
                      value={settings.shortThresholdPercent}
                      disabled={!on}
                      onDrag={(value) =>
                        draft({ shortThresholdPercent: value })
                      }
                      onCommit={(value) =>
                        patch({ shortThresholdPercent: value })
                      }
                    />
                  ) : null}
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
                        basis={settings.switchOn}
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
                        onDragOver={(pointerY, rect) =>
                          reorder(id, pointerY, rect)
                        }
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
                  <SettingRow title={t("上游返回 429")}>
                    <Switch
                      aria-label={t("上游返回 429")}
                      checked={settings.triggerOn429}
                      disabled={!on}
                      onCheckedChange={(value) =>
                        patch({ triggerOn429: value })
                      }
                    />
                  </SettingRow>
                  <SettingRow title={t("认证失效或账号停用")}>
                    <Switch
                      aria-label={t("认证失效或账号停用")}
                      checked={settings.triggerOnAuthFailure}
                      disabled={!on}
                      onCheckedChange={(value) =>
                        patch({ triggerOnAuthFailure: value })
                      }
                    />
                  </SettingRow>
                  <SettingRow
                    title={t("最短驻留")}
                    hint={t("防止在阈值附近来回横跳。")}
                  >
                    <Select
                      aria-label={t("最短驻留")}
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
                  </SettingRow>
                  <SettingRow title={t("恢复后切回更高优先级")}>
                    <Switch
                      aria-label={t("恢复后切回更高优先级")}
                      checked={settings.switchBackToHigherPriority}
                      disabled={!on}
                      onCheckedChange={(value) =>
                        patch({ switchBackToHigherPriority: value })
                      }
                    />
                  </SettingRow>
                  <SettingRow title={t("全部低于阈值时")}>
                    <Select
                      aria-label={t("全部低于阈值时")}
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
                  </SettingRow>
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
                            {t("切到 {{account}}", {
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
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  )
}
