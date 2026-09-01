import { useState } from "react"
import {
  PlayIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

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
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import {
  isIntercepting,
  runtimeState,
  runtimeTone,
  type RuntimeState,
} from "@/lib/codex-runtime"
import { shortAccountId } from "@/lib/format"
import { cn } from "@/lib/utils"
import type {
  AccountView,
  CodexStatusView,
  GatewayService,
  RequestLogsResponse,
} from "@/services/contracts"

type CodexAction = "apply" | "restore" | "restart"

const TONE: Record<
  ReturnType<typeof runtimeTone>,
  { text: string; dot: string }
> = {
  success: { text: "text-emphasis-success", dot: "bg-emphasis-success" },
  warning: { text: "text-emphasis-warning", dot: "bg-emphasis-warning" },
  destructive: {
    text: "text-emphasis-destructive",
    dot: "bg-emphasis-destructive",
  },
}

const HEADLINE: Record<RuntimeState, string> = {
  config_missing: "找不到 Codex 配置",
  not_applied: "尚未接管 Codex 的请求",
  codex_stopped: "已接管，等待 Codex 启动",
  passthrough: "已接管，按 Codex 默认账号透传",
  managed: "已接管 Codex 的全部请求",
  route_blocked: "已接管出口，但换不到可用身份",
}

const ACTION_COPY = {
  apply: [
    "应用 Codex Router 配置？",
    "将备份当前配置并把 Codex 的 openai_base_url 指向本地 Codex Router。",
  ],
  restore: [
    "恢复原始 Codex 配置？",
    "将从 Codex Router 创建的备份恢复配置，之后请求不会再经过本地 Codex Router。",
  ],
  restart: ["重启 Codex？", "Codex 将短暂关闭并重新启动，以读取当前配置。"],
} as const

export function TakeoverHero({
  status,
  accounts,
  service,
  reload,
  onShowAccounts,
  summary,
  histogram,
  from,
  rangeLabel,
  uptimeLabel,
  className,
  reloading,
}: {
  status: CodexStatusView
  accounts: AccountView[]
  service: GatewayService
  reload(): Promise<void>
  onShowAccounts(): void
  summary: RequestLogsResponse["summary"]
  histogram: RequestLogsResponse["histogram"]
  from: number
  rangeLabel: string
  uptimeLabel: string
  className?: string
  /** The window is reloading; the action buttons keep their own `busy`. */
  reloading?: boolean
}) {
  const { t, i18n } = useTranslation()
  const [confirming, setConfirming] = useState<CodexAction | null>(null)
  const [busy, setBusy] = useState<CodexAction | null>(null)
  const locale = i18n.resolvedLanguage ?? "zh-CN"

  const state = runtimeState(status, accounts)
  const tone = TONE[runtimeTone(state)]
  const active = accounts.find((account) => account.isActive) ?? null
  const intercepting = isIntercepting(state)

  // Nothing reaches us before the config is rewritten, so the count and the
  // bars stay at zero rather than borrowing the gateway's own totals.
  //
  // Both come from the server aggregate rather than the timeline, which is a
  // capped sample: counting it would have stopped at 500 and its oldest
  // buckets would have read as idle on a busy day.
  const series = intercepting ? histogram : []
  const peak = Math.max(1, ...series.map((bucket) => bucket.requests))
  const forwarded = intercepting ? summary.requests : 0
  const latest = intercepting
    ? series.reduce(
        (newest, bucket) => (bucket.requests ? bucket.endedAt : newest),
        0
      )
    : 0

  const identity =
    state === "passthrough"
      ? t("Codex 默认账号")
      : state === "route_blocked"
        ? t("无可用账号")
        : active
          ? (active.email ?? shortAccountId(active.chatgptAccountId))
          : t("未选择账号")

  const figures = [
    {
      label: t("请求出口"),
      value: intercepting
        ? status.gatewayBaseUrl
        : (status.openaiBaseUrl ?? t("Codex 默认出口")),
    },
    { label: t("请求身份"), value: identity },
    {
      label: t("最近请求"),
      value: latest
        ? new Date(latest).toLocaleTimeString(locale)
        : t("暂无记录"),
    },
  ]

  const run = async () => {
    if (!confirming) return
    const action = confirming
    setConfirming(null)
    setBusy(action)
    try {
      if (action === "apply") await service.applyCodexConfig()
      else if (action === "restore") await service.restoreCodexConfig()
      else await service.restartCodex()
      await reload()
      toast.add({
        title: t(
          action === "apply"
            ? "Codex Router 配置已应用"
            : action === "restore"
              ? "Codex 配置已恢复"
              : "Codex 已重启"
        ),
        type: "success",
      })
    } catch (error) {
      toast.add({
        title: t("操作失败"),
        description: (error as Error).message,
        type: "error",
      })
    } finally {
      setBusy(null)
    }
  }

  const restore = status.hasBackup ? (
    <Button
      variant="outline"
      size="sm"
      className="border-emphasis-muted/40 bg-transparent text-emphasis-foreground hover:bg-emphasis hover:text-emphasis-foreground"
      disabled={busy !== null}
      onClick={() => setConfirming("restore")}
    >
      {busy === "restore" ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <RotateCcwIcon data-icon="inline-start" />
      )}
      {t("恢复原始配置")}
    </Button>
  ) : null

  return (
    <section
      aria-busy={reloading}
      className={cn(
        "flex flex-col rounded-2xl bg-emphasis p-2 text-emphasis-foreground",
        className
      )}
    >
      {/* No wrapping: the headline is a number whose width changes with the
          window, and letting the figures drop to a second line made every
          filter change reflow everything below them. */}
      <div className="flex items-start justify-between gap-4 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-xs text-emphasis-muted">
            <span
              aria-hidden="true"
              className={cn("size-2 shrink-0 rounded-full", tone.dot)}
            />
            {t("{{range}}经 Router 转发", { range: rangeLabel })}
          </p>
          <p className="mt-1 flex items-baseline gap-x-3">
            <span className="font-brand text-3xl leading-none font-semibold tabular-nums">
              {forwarded.toLocaleString(locale)}
            </span>
            <span className={cn("text-xs font-medium", tone.text)}>
              {t(HEADLINE[state])}
            </span>
          </p>
        </div>
        <ul className="flex shrink-0 gap-6 text-right">
          {figures.map((figure) => (
            <li className="min-w-0" key={figure.label}>
              <p className="text-xs text-emphasis-muted">{figure.label}</p>
              <p
                className="mt-0.5 max-w-52 truncate font-mono text-xs font-semibold"
                title={figure.value}
              >
                {figure.value}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-1 flex-col rounded-xl bg-emphasis-surface p-3">
        {series.length ? (
          <div
            className="flex h-20 items-end gap-1"
            role="img"
            aria-label={t("{{range}}每小时经 Router 转发的请求数", {
              range: rangeLabel,
            })}
          >
            {series.map((bucket) => (
              <span
                className={cn(
                  "min-w-0 flex-1 rounded-[2px]",
                  bucket.requests ? "bg-chart-3" : "bg-emphasis-muted/25"
                )}
                style={{
                  height: `${Math.max((bucket.requests / peak) * 100, 3)}%`,
                }}
                key={bucket.startedAt}
              />
            ))}
          </div>
        ) : (
          <p className="flex h-20 items-center justify-center rounded-lg border border-dashed border-emphasis-muted/30 px-6 text-center text-xs text-emphasis-muted">
            {intercepting
              ? t("这段时间内没有请求经过 Router")
              : t("Codex 仍在直接访问上游，没有请求经过 Router")}
          </p>
        )}
        <div className="mt-1.5 flex justify-between text-xs text-emphasis-muted tabular-nums">
          <span>{new Date(from).toLocaleString(locale)}</span>
          <span>{t("现在")}</span>
        </div>

        {/* Facts and actions share the foot of the panel: the buttons act on
            what the panel shows, so they sit on the same surface as it. */}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-emphasis-muted/25 pt-3">
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  status.codexRunning ? tone.dot : "bg-emphasis-muted/50"
                )}
              />
              <dt className="sr-only">{t("Codex 进程")}</dt>
              <dd
                className={
                  status.codexRunning ? tone.text : "text-emphasis-muted"
                }
              >
                {t(status.codexRunning ? "Codex 正在运行" : "Codex 当前未运行")}
              </dd>
            </div>
            <div className="text-emphasis-muted">
              <dt className="sr-only">{t("已运行")}</dt>
              <dd>{t("Router 已运行 {{uptime}}", { uptime: uptimeLabel })}</dd>
            </div>
          </dl>

          {/* ml-auto rather than justify-between alone: once the row wraps, a
              lone group falls back to the left edge. */}
          <div className="ml-auto flex flex-wrap gap-2">
            {state === "config_missing" ? null : state === "not_applied" ? (
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={() => setConfirming("apply")}
              >
                {busy === "apply" ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <ShieldCheckIcon data-icon="inline-start" />
                )}
                {t("应用 Codex Router")}
              </Button>
            ) : state === "codex_stopped" ? (
              restore
            ) : state === "route_blocked" ? (
              <>
                {restore}
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={onShowAccounts}
                >
                  <UserRoundIcon data-icon="inline-start" />
                  {t("前往账号路由")}
                </Button>
              </>
            ) : (
              <>
                {restore}
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setConfirming("restart")}
                >
                  {busy === "restart" ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <PlayIcon data-icon="inline-start" />
                  )}
                  {t("重启 Codex")}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(confirming ? ACTION_COPY[confirming][0] : "确认操作")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming ? t(ACTION_COPY[confirming][1]) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("取消")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run()}>
              {t("确认")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
