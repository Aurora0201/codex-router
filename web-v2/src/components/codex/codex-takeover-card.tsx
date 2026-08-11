import { useState } from "react"
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  DatabaseBackupIcon,
  NetworkIcon,
  PlayIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import type { CodexStatusView, GatewayService } from "@/services/contracts"

type CodexAction = "apply" | "restore" | "restart"

export function CodexTakeoverCard({
  status,
  service,
  reload,
}: {
  status: CodexStatusView
  service: GatewayService
  reload(): Promise<void>
}) {
  const [confirming, setConfirming] = useState<CodexAction | null>(null)
  const [busy, setBusy] = useState<CodexAction | null>(null)
  const actionCopy = {
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
        title:
          action === "apply"
            ? "Codex Router 配置已应用"
            : action === "restore"
              ? "Codex 配置已恢复"
              : "Codex 已重启",
        type: "success",
      })
    } catch (error) {
      toast.add({
        title: "操作失败",
        description: (error as Error).message,
        type: "error",
      })
    } finally {
      setBusy(null)
    }
  }

  const takeoverReady = status.applied && status.codexRunning
  const title = takeoverReady
    ? "Codex 已通过 Codex Router 接管"
    : status.applied
      ? "Codex Router 已配置，Codex 未运行"
      : "Codex 尚未接入 Codex Router"
  const description = takeoverReady
    ? "后续 Codex 请求将进入本地 Codex Router，并由手动选定的账号处理。"
    : status.applied
      ? "重启 Codex 以加载已经写入的 Codex Router 配置。"
      : "应用配置后，Codex 请求才会经过本地 Codex Router。"

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium [&_svg]:size-3.5",
              takeoverReady
                ? "text-success"
                : status.applied
                  ? "text-destructive"
                  : "text-muted-foreground"
            )}
          >
            {takeoverReady ? (
              <CircleCheckIcon aria-hidden="true" />
            ) : status.applied ? (
              <CircleXIcon aria-hidden="true" />
            ) : (
              <CircleDashedIcon aria-hidden="true" />
            )}
            {takeoverReady
              ? "接管正常"
              : status.applied
                ? "需要重启"
                : "未接管"}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!status.configExists ? (
          <Alert variant="destructive">
            <AlertTitle>找不到配置文件</AlertTitle>
            <AlertDescription>
              请先启动一次 Codex，再尝试应用 Codex Router 配置。
            </AlertDescription>
          </Alert>
        ) : !status.applied ? (
          <Alert>
            <CircleDashedIcon />
            <AlertTitle>Codex 尚未接管</AlertTitle>
            <AlertDescription>
              当前 Codex 地址为 {status.openaiBaseUrl ?? "未配置"}。
            </AlertDescription>
          </Alert>
        ) : !status.codexRunning ? (
          <Alert variant="destructive">
            <CircleXIcon />
            <AlertTitle>Codex 未运行</AlertTitle>
            <AlertDescription>
              Codex Router 配置已经写入，重启 Codex 后才会开始接管请求。
            </AlertDescription>
          </Alert>
        ) : null}
        <ItemGroup className="grid gap-2 md:grid-cols-3">
          <Item variant="muted">
            <ItemMedia variant="icon">
              <NetworkIcon />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle>Codex Router 请求入口</ItemTitle>
              <ItemDescription className="truncate font-mono text-xs">
                {status.gatewayBaseUrl}
              </ItemDescription>
            </ItemContent>
          </Item>
          <Item variant="muted">
            <ItemMedia variant="icon">
              {status.codexRunning ? <CircleCheckIcon /> : <CircleXIcon />}
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Codex 进程</ItemTitle>
              <ItemDescription>
                {status.codexRunning ? "正在运行" : "当前未运行"}
              </ItemDescription>
            </ItemContent>
          </Item>
          <Item variant="muted">
            <ItemMedia variant="icon">
              <DatabaseBackupIcon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>配置备份</ItemTitle>
              <ItemDescription>
                {status.hasBackup ? "可以恢复原始配置" : "尚未创建备份"}
              </ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>
        <Separator />
        <div
          className="flex items-center justify-between gap-6 text-xs"
          role="status"
        >
          <span
            className={cn(
              "inline-flex items-center gap-1.5 font-medium [&_svg]:size-3.5",
              status.codexRunning ? "text-success" : "text-destructive"
            )}
          >
            {status.codexRunning ? (
              <CircleCheckIcon aria-hidden="true" />
            ) : (
              <CircleXIcon aria-hidden="true" />
            )}
            {status.codexRunning ? "Codex 正在运行" : "Codex 未运行"}
          </span>
          <span className="ml-auto max-w-[65%] truncate text-right font-mono text-muted-foreground">
            {status.configPath}
          </span>
        </div>
      </CardContent>
      <CardFooter className="flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          disabled={busy !== null || !status.hasBackup}
          onClick={() => setConfirming("restore")}
        >
          {busy === "restore" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RotateCcwIcon data-icon="inline-start" />
          )}
          恢复配置
        </Button>
        <Button
          variant="outline"
          disabled={busy !== null}
          onClick={() => setConfirming("restart")}
        >
          {busy === "restart" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <PlayIcon data-icon="inline-start" />
          )}
          重启 Codex
        </Button>
        <Button
          disabled={busy !== null || !status.configExists || status.applied}
          onClick={() => setConfirming("apply")}
        >
          {busy === "apply" ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <ShieldCheckIcon data-icon="inline-start" />
          )}
          应用 Codex Router
        </Button>
      </CardFooter>
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => {
          if (!open) setConfirming(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirming ? actionCopy[confirming][0] : "确认操作"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming ? actionCopy[confirming][1] : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run()}>
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
