import { useState, type ReactNode } from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  PlayIcon,
  RotateCcwIcon,
  ServerIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react"
import openAiIconUrl from "@lobehub/icons-static-svg/icons/openai.svg"
import { useTranslation } from "react-i18next"

import { BrandMark } from "@/components/app/brand-mark"
import { MetricIconMedia } from "@/components/app/metric-icon-media"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { shortAccountId } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { AccountView, CodexStatusView, GatewayService } from "@/services/contracts"

type CodexAction = "apply" | "restore" | "restart"
type RuntimeState = "config_missing" | "not_applied" | "codex_stopped" | "passthrough" | "managed" | "route_blocked"

const openAiMaskStyle = {
  maskImage: `url("${openAiIconUrl}")`,
  maskPosition: "center",
  maskRepeat: "no-repeat",
  maskSize: "contain",
  WebkitMaskImage: `url("${openAiIconUrl}")`,
  WebkitMaskPosition: "center",
  WebkitMaskRepeat: "no-repeat",
  WebkitMaskSize: "contain",
}

function OpenAiMark() {
  return <span data-slot="metric-mark" aria-hidden="true" className="bg-current" style={openAiMaskStyle} />
}

function FlowConnector() {
  return (
    <div aria-hidden="true" className="relative mx-auto size-8 shrink-0 text-muted-foreground">
      <div className="absolute top-1/2 left-0 hidden h-px w-[calc(100%_-_0.375rem)] -translate-y-1/2 bg-border sm:block" />
      <ChevronRightIcon className="absolute top-1/2 right-0 hidden -translate-y-1/2 sm:block" />
      <div className="absolute top-0 left-1/2 h-[calc(100%_-_0.375rem)] w-px -translate-x-1/2 bg-border sm:hidden" />
      <ChevronDownIcon className="absolute bottom-0 left-1/2 -translate-x-1/2 sm:hidden" />
    </div>
  )
}

function FlowItem({ children, flowing, step }: { children: ReactNode; flowing: boolean; step: 0 | 1 | 2 }) {
  return (
    <Item
      variant="muted"
      className="route-flow-item relative min-h-16 min-w-0 overflow-hidden border-border/60"
      data-flowing={flowing || undefined}
      data-flow-step={step}
    >
      {children}
    </Item>
  )
}

export function CodexTakeoverCard({
  status,
  accounts,
  service,
  reload,
  onShowAccounts,
}: {
  status: CodexStatusView
  accounts: AccountView[]
  service: GatewayService
  reload(): Promise<void>
  onShowAccounts(): void
}) {
  const [confirming, setConfirming] = useState<CodexAction | null>(null)
  const [busy, setBusy] = useState<CodexAction | null>(null)
  const { t } = useTranslation()
  const active = accounts.find((account) => account.isActive) ?? null
  const activeReady = active?.enabled === true && active.authStatus === "ready"
  const runtimeState: RuntimeState = !status.configExists
    ? "config_missing"
    : !status.applied
      ? "not_applied"
      : !status.codexRunning
        ? "codex_stopped"
        : accounts.length === 0
          ? "passthrough"
          : activeReady
            ? "managed"
            : "route_blocked"

  const copy: Record<RuntimeState, { title: string; description: string; badge: string }> = {
    config_missing: { title: "找不到 Codex 配置", description: "请先启动一次 Codex，使其创建配置文件后再应用 Codex Router。", badge: "需要处理" },
    not_applied: { title: "Codex 尚未接入 Router", description: "应用配置后，Codex 请求将进入本地 Codex Router。", badge: "未接管" },
    codex_stopped: { title: "配置已应用，Codex 当前未运行", description: "请自行启动 Codex；启动后将使用已经写入的 Codex Router 配置。", badge: "等待启动" },
    passthrough: { title: "Codex 默认账号透传", description: "账号池为空，请求使用 Codex 当前登录账号且不替换身份。", badge: "透传正常" },
    managed: { title: "Codex Router 接管正常", description: "后续请求使用当前手动选择的托管账号。", badge: "接管正常" },
    route_blocked: { title: "等待可用的路由账号", description: "账号池非空，但当前没有已选择且认证就绪的账号。", badge: "路由阻断" },
  }
  const stateCopy = copy[runtimeState]
  const healthy = runtimeState === "managed" || runtimeState === "passthrough"
  const blocked = runtimeState === "config_missing" || runtimeState === "route_blocked"
  const target = runtimeState === "passthrough"
    ? t("Codex 默认账号")
    : runtimeState === "managed" && active
      ? active.email ?? shortAccountId(active.chatgptAccountId)
      : t("等待选择可用账号")

  const actionCopy = {
    apply: ["应用 Codex Router 配置？", "将备份当前配置并把 Codex 的 openai_base_url 指向本地 Codex Router。"],
    restore: ["恢复原始 Codex 配置？", "将从 Codex Router 创建的备份恢复配置，之后请求不会再经过本地 Codex Router。"],
    restart: ["重启 Codex？", "Codex 将短暂关闭并重新启动，以读取当前配置。"],
  } as const

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
        title: t(action === "apply" ? "Codex Router 配置已应用" : action === "restore" ? "Codex 配置已恢复" : "Codex 已重启"),
        type: "success",
      })
    } catch (error) {
      toast.add({ title: t("操作失败"), description: (error as Error).message, type: "error" })
    } finally {
      setBusy(null)
    }
  }

  const restoreButton = status.hasBackup ? (
    <Button variant="outline" disabled={busy !== null} onClick={() => setConfirming("restore")}>
      {busy === "restore" ? <Spinner data-icon="inline-start" /> : <RotateCcwIcon data-icon="inline-start" />}
      {t("恢复配置")}
    </Button>
  ) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(stateCopy.title)}</CardTitle>
        <CardDescription>{t(stateCopy.description)}</CardDescription>
        <CardAction>
          <Badge variant="outline" className={cn(healthy && "text-success", blocked && "text-destructive", !healthy && !blocked && "text-warning")}>
            {healthy ? <CircleCheckIcon data-icon="inline-start" /> : blocked ? <CircleXIcon data-icon="inline-start" /> : <CircleDashedIcon data-icon="inline-start" />}
            {t(stateCopy.badge)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ItemGroup className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]" aria-label={t("当前路由链路")}>
          <FlowItem flowing={healthy} step={0}>
            <MetricIconMedia className="text-foreground"><OpenAiMark /></MetricIconMedia>
            <ItemContent className="min-w-0"><ItemTitle>{t("Codex")}</ItemTitle><ItemDescription>{status.codexRunning ? t("正在运行") : t("当前未运行")}</ItemDescription></ItemContent>
          </FlowItem>
          <FlowConnector />
          <FlowItem flowing={healthy} step={1}>
            <MetricIconMedia className="text-foreground"><BrandMark data-slot="metric-mark" /></MetricIconMedia>
            <ItemContent className="min-w-0"><ItemTitle>Codex Router</ItemTitle><ItemDescription>{status.applied ? t("请求入口已配置") : t("等待应用配置")}</ItemDescription></ItemContent>
          </FlowItem>
          <FlowConnector />
          <FlowItem flowing={healthy} step={2}>
            <MetricIconMedia className="text-foreground"><ServerIcon /></MetricIconMedia>
            <ItemContent className="min-w-0"><ItemTitle>{t("目标身份")}</ItemTitle><ItemDescription className="truncate" title={target}>{target}</ItemDescription></ItemContent>
          </FlowItem>
        </ItemGroup>
      </CardContent>
      {runtimeState !== "config_missing" && !(runtimeState === "codex_stopped" && !restoreButton) ? (
        <CardFooter className="flex-wrap justify-end gap-2">
          {runtimeState === "not_applied" ? (
            <Button disabled={busy !== null} onClick={() => setConfirming("apply")}>
              {busy === "apply" ? <Spinner data-icon="inline-start" /> : <ShieldCheckIcon data-icon="inline-start" />}
              {t("应用 Codex Router")}
            </Button>
          ) : runtimeState === "codex_stopped" ? (
            restoreButton
          ) : runtimeState === "route_blocked" ? (
            <>{restoreButton}<Button disabled={busy !== null} onClick={onShowAccounts}><UserRoundIcon data-icon="inline-start" />{t("前往账号路由")}</Button></>
          ) : (
            <>{restoreButton}<Button variant="outline" disabled={busy !== null} onClick={() => setConfirming("restart")}><PlayIcon data-icon="inline-start" />{t("重启 Codex")}</Button></>
          )}
        </CardFooter>
      ) : null}
      <AlertDialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(confirming ? actionCopy[confirming][0] : "确认操作")}</AlertDialogTitle>
            <AlertDialogDescription>{confirming ? t(actionCopy[confirming][1]) : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>{t("取消")}</AlertDialogCancel><AlertDialogAction onClick={() => void run()}>{t("确认")}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
