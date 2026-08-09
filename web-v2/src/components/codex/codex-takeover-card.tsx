import { useState } from "react"
import { PlayIcon, RotateCcwIcon, ShieldCheckIcon } from "lucide-react"

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
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
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
      "应用 Gateway 配置？",
      "将备份当前配置并把 Codex 的 openai_base_url 指向本地 Gateway。",
    ],
    restore: [
      "恢复原始 Codex 配置？",
      "将从 Gateway 创建的备份恢复配置，之后请求不会再经过本地 Gateway。",
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
            ? "Gateway 配置已应用"
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

  const rows = [
    ["配置文件", status.configPath],
    ["Gateway 目标", status.gatewayBaseUrl],
    ["当前地址", status.openaiBaseUrl ?? "未配置"],
    ["模型目录", status.modelCatalogJson ?? "由 Gateway /models 提供"],
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Codex 接管</CardTitle>
        <CardDescription>
          管理全局配置的 Gateway 注入、备份恢复和进程重启。
        </CardDescription>
        <CardAction>
          <Badge variant={status.applied ? "default" : "secondary"}>
            {status.applied ? "已应用" : "未应用"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!status.configExists ? (
          <Alert variant="destructive">
            <AlertTitle>找不到配置文件</AlertTitle>
            <AlertDescription>
              请先启动一次 Codex，再尝试应用 Gateway 配置。
            </AlertDescription>
          </Alert>
        ) : null}
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-lg bg-muted/60 p-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="mt-1 font-mono text-xs break-all">{value}</dd>
            </div>
          ))}
        </dl>
        <Separator />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.codexRunning ? "outline" : "destructive"}>
            {status.codexRunning ? "Codex 正在运行" : "Codex 未运行"}
          </Badge>
          <Badge variant={status.hasBackup ? "outline" : "secondary"}>
            {status.hasBackup ? "备份可用" : "尚无备份"}
          </Badge>
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
          应用 Gateway
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
