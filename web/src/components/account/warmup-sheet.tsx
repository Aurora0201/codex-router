import { useCallback, useEffect, useMemo, useState } from "react"
import {
  FlameIcon,
  HistoryIcon,
  ListChecksIcon,
  MessageSquareTextIcon,
  PlugZapIcon,
  Settings2Icon,
  SparklesIcon,
  TimerResetIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
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
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { Section } from "@/components/account/sheet-section"
import {
  formatCountdown,
  formatRelativeTime,
  shortAccountId,
} from "@/lib/format"
import { cn } from "@/lib/utils"
import type {
  AccountsResponse,
  GatewayService,
  WarmupLogEntryView,
  WarmupModelView,
  WarmupView,
} from "@/services/contracts"

/** The catalog's effort ids, said in the user's terms. */
const EFFORT_LABEL: Record<string, string> = {
  none: "不思考",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "很高",
  max: "最高",
  ultra: "极高",
}

/** Codes the gateway classifies a failure into, said in the user's terms. */
const ERROR_LABEL: Record<string, string> = {
  relogin_required: "需要重新登录",
  rate_limited: "上游限流",
  timeout: "超时",
  model_unavailable: "模型不可用",
  app_server_unavailable: "Codex 没能启动",
  warmup_failed: "发送失败",
}

/** The clock time a window resets at, which is the only part worth reading. */
function resetClock(resetsAt: number | null): string | null {
  if (resetsAt === null) return null
  return new Date(resetsAt).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function LogRow({
  entry,
  label,
}: {
  entry: WarmupLogEntryView
  label: string
}) {
  const { t } = useTranslation()
  // A warm-up that "succeeded" but left the window where it was did not do the
  // job, so the row reports the window rather than the turn.
  const started =
    entry.windowAfterResetsAt !== null &&
    entry.windowAfterResetsAt !== entry.windowBeforeResetsAt
  return (
    <li className="grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-3 py-1.5 first:pt-0 last:pb-0">
      <span className="text-xs text-muted-foreground-subtle tabular-nums">
        {formatRelativeTime(entry.startedAt)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm">{label}</span>
        <span
          className={cn(
            "block truncate text-xs",
            entry.outcome === "failed"
              ? "text-destructive"
              : "text-muted-foreground"
          )}
        >
          {entry.outcome === "failed"
            ? t(ERROR_LABEL[entry.errorCode ?? ""] ?? "发送失败")
            : started
              ? t("窗口已开始 · {{time}} 重置", {
                  time: resetClock(entry.windowAfterResetsAt),
                })
              : t("已发送，窗口未变化")}
        </span>
      </span>
      {/* Who asked, which is a different question from whether it worked —
          the outcome is already said on the line beside it. */}
      <span className="shrink-0 rounded bg-muted px-1.5 text-xs font-medium text-muted-foreground">
        {t(entry.trigger === "auto" ? "自动" : "手动")}
      </span>
    </li>
  )
}

/**
 * Warm-up: a split control on the accounts page. The left half spends, and says
 * exactly what it is about to spend on before it does; the right half opens
 * everything behind it.
 */
export function WarmupButton({
  routing,
  service,
}: {
  /** Same beat as the auto-switch button: a new object per gateway tick. */
  routing: AccountsResponse
  service: GatewayService
}) {
  const { t } = useTranslation()
  const { accounts } = routing
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<WarmupView | null>(null)
  const [models, setModels] = useState<WarmupModelView[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [draftMessage, setDraftMessage] = useState<string | null>(null)

  const beat = open ? null : routing
  const reload = useCallback(
    (cancelled: () => boolean) => {
      void service
        .getWarmup()
        .then((next) => {
          if (cancelled()) return
          setFailure(null)
          setState(next)
        })
        .catch((error: Error) => {
          if (!cancelled()) setFailure(error.message)
        })
    },
    [service]
  )

  useEffect(() => {
    let done = false
    reload(() => done)
    return () => {
      done = true
    }
  }, [reload, beat, attempt])

  // While a run is going the gateway is the only source of progress, so the
  // button follows it rather than guessing from its own click.
  const running = state?.progress.running ?? false
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => reload(() => false), 1200)
    return () => window.clearInterval(timer)
  }, [running, reload])

  // The catalog costs an app-server launch, so it is read when the sheet opens
  // and not before.
  useEffect(() => {
    if (!open || models !== null) return
    void service
      .getWarmupModels()
      .then((next) => setModels(next.models))
      .catch(() => setModels([]))
  }, [open, models, service])

  const settings = state?.settings ?? null
  const byId = useMemo(
    () =>
      new Map(
        accounts.map((account) => [
          account.id,
          shortAccountId(account.chatgptAccountId),
        ])
      ),
    [accounts]
  )

  // Which efforts are on offer belongs to the model, so the list follows the
  // picker above it rather than being a fixed set this console invented.
  const efforts =
    (settings?.model === null || settings?.model === undefined
      ? (models?.find((model) => model.isDefault) ?? models?.[0])
      : models?.find((model) => model.id === settings.model)
    )?.efforts ?? []

  /**
   * What the automatic pass has done and when it can next matter. Without it
   * "nothing happened" and "it looked and there was nothing to do" are the
   * same sight — which is what sent someone to force a run that turned out to
   * change nothing.
   */
  const lastAuto = state?.recent.find((entry) => entry.trigger === "auto")
  const nextDue = (state?.accounts ?? [])
    // A spent week's five-hour window lapsing is not something the automatic
    // pass will act on, so it is not "next" either.
    .filter(
      (account) =>
        account.enrolled && account.eligible && !account.weeklyExhausted
    )
    .map((account) => account.windowResetsAt)
    .filter((resetsAt): resetsAt is number => resetsAt !== null)
    .sort((a, b) => a - b)[0]
  const autoHint = !settings?.auto
    ? undefined
    : lastAuto
      ? t("上次 {{time}} · 下个窗口 {{next}} 到期", {
          time: resetClock(lastAuto.startedAt),
          next: nextDue === undefined ? "—" : resetClock(nextDue),
        })
      : nextDue === undefined
        ? t("待命中")
        : t("下个窗口 {{next}} 到期", { next: resetClock(nextDue) })

  const pending = (state?.accounts ?? []).filter(
    (account) =>
      account.enrolled &&
      account.eligible &&
      !account.weeklyExhausted &&
      !account.windowRunning
  )

  const patch = (values: Parameters<GatewayService["saveWarmup"]>[0]) => {
    setState((current) =>
      current
        ? { ...current, settings: { ...current.settings, ...values } }
        : current
    )
    void service.saveWarmup(values).catch((error: Error) =>
      toast.add({
        title: t("保存失败"),
        description: error.message,
        type: "error",
      })
    )
  }

  const toggleAccount = (id: string, enrolled: boolean) => {
    setState((current) =>
      current
        ? {
            ...current,
            accounts: current.accounts.map((account) =>
              account.id === id ? { ...account, enrolled } : account
            ),
          }
        : current
    )
    void service
      .saveWarmupEnrollment({ enrolled: { [id]: enrolled } })
      .catch((error: Error) =>
        toast.add({
          title: t("保存失败"),
          description: error.message,
          type: "error",
        })
      )
  }

  const run = (force: boolean) => {
    void service
      .runWarmup(force ? { force: true } : {})
      .then(() => reload(() => false))
      .catch((error: Error) =>
        toast.add({
          title: t("预热没能开始"),
          description: error.message,
          type: "error",
        })
      )
  }

  const runLabel = running
    ? t("预热中 {{done}}/{{total}}", {
        done: state!.progress.done,
        total: state!.progress.total,
      })
    : pending.length === 0
      ? t("无需预热")
      : t("预热 {{count}} 个账号", { count: pending.length })

  return (
    <div className="flex flex-1 sm:flex-none">
      {/* Split: the left half spends quota, so it never says anything vaguer
          than the number of accounts it is about to spend on. */}
      <Button
        className="h-9 flex-1 rounded-l-xl rounded-r-none border-r-0 sm:flex-none"
        variant="outline"
        data-slot="warmup-run"
        disabled={state === null || running || pending.length === 0}
        onClick={() => run(false)}
        aria-label={t("预热账号")}
      >
        <FlameIcon
          aria-hidden="true"
          data-icon="inline-start"
          className={running ? "animate-pulse" : undefined}
        />
        {runLabel}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          render={
            <Button
              className="h-9 rounded-l-none rounded-r-xl px-2.5"
              variant="outline"
              aria-label={t("预热设置")}
            >
              <Settings2Icon aria-hidden="true" />
            </Button>
          }
        />
        <SheetContent className="w-full data-[side=right]:sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{t("预热账号")}</SheetTitle>
            <SheetDescription>
              {t(
                "额度窗口只在被用过一次之后才开始计时。预热就是替每个账号发出那一次。"
              )}
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
                  {t(
                    "多半是正在运行的网关还是旧版本，重启一次网关就会带上这个接口。"
                  )}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <p className="text-xs text-muted-foreground-subtle">
                  {failure}
                </p>
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
                <Section
                  title={t("窗口重置后自动预热")}
                  icon={TimerResetIcon}
                  hint={autoHint}
                  description={t(
                    "网关看到某个账号的 5 小时窗口过期就补一条。开机后的第一次状态刷新也算，所以早上开机会自动补齐。"
                  )}
                  control={
                    <Switch
                      aria-label={t("窗口重置后自动预热")}
                      checked={settings.auto}
                      onCheckedChange={(value) => patch({ auto: value })}
                    />
                  }
                />

                <Section
                  title={t("发送什么")}
                  icon={MessageSquareTextIcon}
                  hint={t("所有账号相同")}
                >
                  <div className="grid gap-3">
                    {/* Two short pickers side by side: each holds one word, and a
                        row apiece left the section mostly air. */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-1.5">
                        <label
                          className="text-sm font-medium"
                          htmlFor="warmup-model"
                        >
                          {t("使用模型")}
                        </label>
                        <Select
                          value={settings.model ?? ""}
                          onValueChange={(value) =>
                            patch({
                              model: value === "" ? null : String(value),
                            })
                          }
                        >
                          <SelectTrigger
                            id="warmup-model"
                            className="w-full"
                            aria-label={t("使用模型")}
                          >
                            <SelectValue>
                              {settings.model === null
                                ? t("跟随账号默认")
                                : (models?.find((m) => m.id === settings.model)
                                    ?.displayName ?? settings.model)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {/* Not every subscription has every model, so the
                                safe choice is each account's own default. */}
                              <SelectItem value="">
                                {t("跟随账号默认")}
                              </SelectItem>
                              {(models ?? []).map((model) => (
                                <SelectItem key={model.id} value={model.id}>
                                  {model.displayName}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1.5">
                        <label
                          className="text-sm font-medium"
                          htmlFor="warmup-effort"
                        >
                          {t("思考强度")}
                        </label>
                        <Select
                          value={settings.effort ?? ""}
                          onValueChange={(value) =>
                            patch({
                              effort: value === "" ? null : String(value),
                            })
                          }
                        >
                          <SelectTrigger
                            id="warmup-effort"
                            className="w-full"
                            aria-label={t("思考强度")}
                          >
                            <SelectValue>
                              {settings.effort === null
                                ? t("跟随模型默认")
                                : (EFFORT_LABEL[settings.effort] ??
                                  settings.effort)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="">
                                {t("跟随模型默认")}
                              </SelectItem>
                              {efforts.map((effort) => (
                                <SelectItem key={effort.id} value={effort.id}>
                                  {EFFORT_LABEL[effort.id] ?? effort.id}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      <label
                        className="text-sm font-medium"
                        htmlFor="warmup-message"
                      >
                        {t("发送内容")}
                      </label>
                      <Input
                        id="warmup-message"
                        value={draftMessage ?? settings.message}
                        maxLength={500}
                        onChange={(event) =>
                          setDraftMessage(event.currentTarget.value)
                        }
                        onBlur={() => {
                          if (draftMessage === null) return
                          patch({ message: draftMessage })
                          setDraftMessage(null)
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("留空恢复默认。越短越省额度。")}
                      </p>
                    </div>
                  </div>
                </Section>

                <Section
                  title={t("参与预热的账号")}
                  icon={ListChecksIcon}
                  hint={t("{{count}} 个待预热", { count: pending.length })}
                >
                  <ul className="grid gap-1.5">
                    {state!.accounts.map((account) => (
                      <li
                        key={account.id}
                        data-slot="warmup-row"
                        className={cn(
                          "flex items-center gap-3 rounded-lg bg-card px-2.5 py-2",
                          (!account.enrolled ||
                            !account.eligible ||
                            account.weeklyExhausted) &&
                            "opacity-55"
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {byId.get(account.id) ?? account.id}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground-subtle">
                            {!account.eligible
                              ? t("不可用")
                              : account.weeklyExhausted
                                ? t("周额度已用完 · {{time}}恢复", {
                                    time:
                                      account.weeklyResetsAt === null
                                        ? "—"
                                        : formatCountdown(
                                            account.weeklyResetsAt
                                          ),
                                  })
                                : account.windowRunning
                                  ? t("窗口计时中 · {{time}} 重置", {
                                      time: resetClock(account.windowResetsAt),
                                    })
                                  : t("窗口未开始")}
                          </span>
                        </span>
                        <Switch
                          checked={account.enrolled}
                          onCheckedChange={(value) =>
                            toggleAccount(account.id, value)
                          }
                          aria-label={t("{{account}} 参与预热", {
                            account: byId.get(account.id) ?? account.id,
                          })}
                        />
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {/* Two surprising things, both worth saying once: these
                          turns never reach the request log, and forcing one on
                          a window that is already counting spends quota
                          without moving anything. */}
                      {t(
                        "预热直接用账号自己的身份发送，不经过路由，因此不会出现在请求日志里。强制预热会给正在计时的窗口也发一条，但那不会重启或延长它。"
                      )}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={running}
                      onClick={() => run(true)}
                    >
                      <SparklesIcon
                        aria-hidden="true"
                        data-icon="inline-start"
                      />
                      {t("全部强制预热")}
                    </Button>
                  </div>
                </Section>

                <Section title={t("预热记录")} icon={HistoryIcon}>
                  {state!.recent.length > 0 ? (
                    <ul className="grid divide-y divide-border">
                      {state!.recent.map((entry) => (
                        <LogRow
                          key={entry.id}
                          entry={entry}
                          label={byId.get(entry.accountId) ?? entry.accountId}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="py-1 text-xs text-muted-foreground">
                      {t("还没有预热记录")}
                    </p>
                  )}
                </Section>
              </div>
            </ScrollArea>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
