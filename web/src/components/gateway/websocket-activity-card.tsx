import { RadioIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { WebSocketConnectionView } from "@/services/contracts"

function shortId(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

function connectedDuration(value: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - value) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function ConnectionStatus({ connection }: { connection: WebSocketConnectionView }) {
  const { t } = useTranslation()
  if (connection.state === "connecting") return <span role="status" className="shimmer text-warning">{t("连接中")}</span>
  if (connection.state === "retiring") return <span role="status" className="shimmer block truncate text-warning">{t("正在退役")} · {t("等待当前请求结束")}</span>
  if (connection.state === "transmitting") return <span role="status" className="shimmer text-success">{t("正在传输")}</span>
  return <span className="text-muted-foreground">{t("空闲")}</span>
}

export function WebSocketActivityCard({ connections }: { connections: WebSocketConnectionView[] }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const update = () => {
      if (!document.hidden) setNow(Date.now())
    }
    const timer = window.setInterval(update, 1_000)
    document.addEventListener("visibilitychange", update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", update)
    }
  }, [])
  const transmitting = connections.filter((connection) => connection.state === "transmitting").length
  return (
    <Card aria-label={t("WebSocket 实时传输")}>
      <CardHeader>
        <CardTitle>{t("WebSocket 实时传输")}</CardTitle>
        <CardDescription>{t("每行代表一条尚未关闭的连接；流动效果只表示当前正在传输数据。")}</CardDescription>
        <CardAction><Badge variant="outline" className="text-success">{t("{{connections}} 条连接 · {{transmitting}} 条传输中", { connections: connections.length, transmitting })}</Badge></CardAction>
      </CardHeader>
      <CardContent className="p-0">
        {connections.length === 0 ? (
          <Empty className="min-h-48 border-0"><EmptyHeader><EmptyMedia variant="icon"><RadioIcon /></EmptyMedia><EmptyTitle>{t("当前没有 WebSocket 连接")}</EmptyTitle><EmptyDescription>{t("Codex 建立连接后会显示在这里。")}</EmptyDescription></EmptyHeader></Empty>
        ) : (
          <Table className="table-fixed text-sm">
            <TableHeader><TableRow>
              <TableHead className="w-[30%] pl-4">{t("连接")}</TableHead>
              <TableHead className="w-[20%]">{t("连接时间")}</TableHead>
              <TableHead className="w-[25%]">{t("状态")}</TableHead>
              <TableHead className="w-[25%]">{t("当前请求")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>{connections.map((connection) => (
              <TableRow key={connection.connectionId} className="h-11">
                <TableCell className="pl-4 align-middle"><Tooltip><TooltipTrigger render={<span className="block truncate font-medium" />}>{shortId(connection.connectionId)}</TooltipTrigger><TooltipContent>{connection.connectionId}</TooltipContent></Tooltip></TableCell>
                <TableCell><span className="text-muted-foreground tabular-nums">{connectedDuration(connection.connectedAt, now)}</span></TableCell>
                <TableCell><ConnectionStatus connection={connection} /></TableCell>
                <TableCell>{connection.activeRequestId ? <Tooltip><TooltipTrigger render={<span className="block truncate" />}>{shortId(connection.activeRequestId)}</TooltipTrigger><TooltipContent>{connection.activeRequestId}</TooltipContent></Tooltip> : <span className="text-muted-foreground">—</span>}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
