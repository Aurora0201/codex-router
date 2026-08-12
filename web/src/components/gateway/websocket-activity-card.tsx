import { RadioIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { WebSocketConnectionView } from "@/services/contracts"

type ConnectionState = WebSocketConnectionView["state"]
type ConnectionOrder = { ids: string[]; states: Map<string, ConnectionState> }

function statePriority(state: ConnectionState): number {
  if (state === "transmitting") return 0
  if (state === "connecting" || state === "retiring") return 1
  return 2
}

function initialOrder(connections: WebSocketConnectionView[]): ConnectionOrder {
  return {
    ids: [...connections]
      .sort((left, right) => statePriority(left.state) - statePriority(right.state))
      .map((connection) => connection.connectionId),
    states: new Map(connections.map((connection) => [connection.connectionId, connection.state])),
  }
}

function updateOrder(previous: ConnectionOrder, connections: WebSocketConnectionView[]): ConnectionOrder {
  const current = new Map(connections.map((connection) => [connection.connectionId, connection]))
  const moved = [[], [], []] as string[][]
  const stable = [[], [], []] as string[][]

  for (const connection of connections) {
    if (previous.states.get(connection.connectionId) !== connection.state) {
      moved[statePriority(connection.state)].push(connection.connectionId)
    }
  }
  for (const connectionId of previous.ids) {
    const connection = current.get(connectionId)
    if (connection && previous.states.get(connectionId) === connection.state) {
      stable[statePriority(connection.state)].push(connectionId)
    }
  }

  return {
    ids: [0, 1, 2].flatMap((priority) => [...moved[priority], ...stable[priority]]),
    states: new Map(connections.map((connection) => [connection.connectionId, connection.state])),
  }
}

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

function activityLabel(connection: WebSocketConnectionView, t: (value: string) => string): string {
  const turn = connection.turnId ? `Turn ${shortId(connection.turnId)}` : ""
  const kind = connection.activityKind === "compaction"
    ? t("上下文压缩")
    : connection.activityKind === "prewarm"
      ? t("预热")
      : connection.activityKind === "response"
        ? t("模型响应")
        : ""
  return [turn, kind].filter(Boolean).join(" · ") || "—"
}

function ConnectionIdentifiers({ connection }: { connection: WebSocketConnectionView }) {
  const { t } = useTranslation()
  return (
    <div className="flex max-w-80 flex-col gap-1">
      <span>{t("对话")}: {connection.threadId ?? "—"}</span>
      <span>Turn: {connection.turnId ?? "—"}</span>
      <span>Session: {connection.sessionId ?? "—"}</span>
      <span>{t("连接")}: {connection.connectionId}</span>
      <span>{t("请求标识")}: {connection.activeRequestId ?? "—"}</span>
    </div>
  )
}

function ConversationLabel({ connection }: { connection: WebSocketConnectionView }) {
  const { t } = useTranslation()
  if (connection.threadId) return <span className="block truncate font-medium">{shortId(connection.threadId)}</span>
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="truncate font-medium">{shortId(connection.connectionId)}</span>
      <span className="shrink-0 text-muted-foreground">· {t("未关联")}</span>
    </span>
  )
}

function AnimatedCellValue({ value, children }: { value: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const animation = useRef<Animation | null>(null)
  const mounted = useRef(false)

  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    animation.current?.cancel()
    animation.current = null
    const element = ref.current
    if (!element || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || typeof element.animate !== "function") return
    const nextAnimation = element.animate(
      [{ opacity: 0, transform: "translateY(2px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 160, easing: "ease-out" },
    )
    animation.current = nextAnimation
    const cleanup = () => {
      if (animation.current === nextAnimation) animation.current = null
    }
    nextAnimation.onfinish = cleanup
    nextAnimation.oncancel = cleanup
  }, [value])

  useEffect(() => () => animation.current?.cancel(), [])

  return <div ref={ref} data-slot="animated-cell-value" className="min-w-0 truncate">{children}</div>
}

export function WebSocketActivityCard({ connections }: { connections: WebSocketConnectionView[] }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())
  const [tableScrolled, setTableScrolled] = useState(false)
  const [order, setOrder] = useState<ConnectionOrder>(() => initialOrder(connections))
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const previousRects = useRef(new Map<string, DOMRect>())
  const rowAnimations = useRef(new Map<string, Animation>())

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOrder((previous) => updateOrder(previous, connections))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [connections])

  const orderedConnections = useMemo(() => {
    const byId = new Map(connections.map((connection) => [connection.connectionId, connection]))
    const ordered = order.ids.flatMap((connectionId) => {
      const connection = byId.get(connectionId)
      return connection ? [connection] : []
    })
    const known = new Set(order.ids)
    return [...ordered, ...connections.filter((connection) => !known.has(connection.connectionId))]
  }, [connections, order.ids])

  useLayoutEffect(() => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    const nextRects = new Map<string, DOMRect>()
    for (const [connectionId, row] of rowRefs.current) {
      rowAnimations.current.get(connectionId)?.cancel()
      rowAnimations.current.delete(connectionId)
      const nextRect = row.getBoundingClientRect()
      nextRects.set(connectionId, nextRect)
      if (reducedMotion || typeof row.animate !== "function") continue
      const previousRect = previousRects.current.get(connectionId)
      if (!previousRect) {
        const animation = row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "ease-out" })
        rowAnimations.current.set(connectionId, animation)
        const cleanup = () => {
          if (rowAnimations.current.get(connectionId) === animation) rowAnimations.current.delete(connectionId)
        }
        animation.onfinish = cleanup
        animation.oncancel = cleanup
        continue
      }
      const deltaY = previousRect.top - nextRect.top
      if (deltaY !== 0) {
        const animation = row.animate([{ transform: `translateY(${deltaY}px)` }, { transform: "translateY(0)" }], { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" })
        rowAnimations.current.set(connectionId, animation)
        const cleanup = () => {
          if (rowAnimations.current.get(connectionId) === animation) rowAnimations.current.delete(connectionId)
        }
        animation.onfinish = cleanup
        animation.oncancel = cleanup
      }
    }
    for (const [connectionId, animation] of rowAnimations.current) {
      if (!rowRefs.current.has(connectionId)) {
        animation.cancel()
        rowAnimations.current.delete(connectionId)
      }
    }
    previousRects.current = nextRects
  }, [orderedConnections])

  useEffect(() => () => {
    for (const animation of rowAnimations.current.values()) animation.cancel()
    rowAnimations.current.clear()
  }, [])

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
    <Card aria-label={t("WebSocket 实时传输")} className="min-h-[18rem] gap-0 overflow-hidden py-0 lg:min-h-0 lg:flex-1 lg:basis-0">
      <CardHeader className="shrink-0 py-(--card-spacing)">
        <CardTitle>{t("WebSocket 实时传输")}</CardTitle>
        <CardDescription>{t("每行代表一条尚未关闭的连接；流动效果只表示当前正在传输数据。")}</CardDescription>
        <CardAction><Badge variant="outline" className="text-success">{t("{{connections}} 条连接 · {{transmitting}} 条传输中", { connections: connections.length, transmitting })}</Badge></CardAction>
      </CardHeader>
      <CardContent className="relative min-h-0 flex-1 overflow-hidden p-0">
        {connections.length === 0 ? (
          <Empty className="h-full min-h-48 border-0"><EmptyHeader><EmptyMedia variant="icon"><RadioIcon /></EmptyMedia><EmptyTitle>{t("当前没有 WebSocket 连接")}</EmptyTitle><EmptyDescription>{t("Codex 建立连接后会显示在这里。")}</EmptyDescription></EmptyHeader></Empty>
        ) : (
          <>
            <ScrollArea
              className="h-full overscroll-contain [&_[data-slot=scroll-area-viewport]]:[contain:paint] [&_[data-slot=scroll-area-viewport]]:[overflow-anchor:none] [&_[data-slot=scroll-area-viewport]]:[scroll-padding-bottom:--spacing(2)] [&_[data-slot=table-container]]:overflow-visible"
              onScrollCapture={(event) => {
                const target = event.target as HTMLElement
                if (target.dataset.slot === "scroll-area-viewport") setTableScrolled(target.scrollTop > 0)
              }}
            >
              <Table className="min-w-[44rem] table-fixed text-sm">
                <TableHeader><TableRow>
                  <TableHead className="sticky top-0 z-10 w-[28%] bg-card pl-4">{t("对话")}</TableHead>
                  <TableHead className="sticky top-0 z-10 w-[37%] bg-card">{t("当前活动")}</TableHead>
                  <TableHead className="sticky top-0 z-10 w-[20%] bg-card">{t("状态")}</TableHead>
                  <TableHead className="sticky top-0 z-10 w-[15%] bg-card">{t("连接时间")}</TableHead>
                </TableRow></TableHeader>
                <TableBody>{orderedConnections.map((connection) => (
                  <TableRow
                    key={connection.connectionId}
                    data-connection-id={connection.connectionId}
                    ref={(row) => {
                      if (row) rowRefs.current.set(connection.connectionId, row)
                      else rowRefs.current.delete(connection.connectionId)
                    }}
                    className="h-11 motion-reduce:transition-none"
                  >
                    <TableCell className="pl-4 align-middle"><Tooltip><TooltipTrigger render={<span className="block min-w-0 truncate" />}><ConversationLabel connection={connection} /></TooltipTrigger><TooltipContent><ConnectionIdentifiers connection={connection} /></TooltipContent></Tooltip></TableCell>
                    <TableCell><AnimatedCellValue value={`${connection.turnId ?? ""}:${connection.activityKind ?? ""}`}><Tooltip><TooltipTrigger render={<span className="block truncate" />}>{activityLabel(connection, t)}</TooltipTrigger><TooltipContent><ConnectionIdentifiers connection={connection} /></TooltipContent></Tooltip></AnimatedCellValue></TableCell>
                    <TableCell><AnimatedCellValue value={connection.state}><ConnectionStatus connection={connection} /></AnimatedCellValue></TableCell>
                    <TableCell><span className="text-muted-foreground tabular-nums">{connectedDuration(connection.connectedAt, now)}</span></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
            <div
              aria-hidden="true"
              data-slot="sticky-header-shadow"
              className={cn(
                "pointer-events-none absolute inset-x-0 top-10 z-20 h-2 bg-linear-to-b from-foreground/10 to-transparent transition-opacity duration-150 motion-reduce:transition-none",
                tableScrolled ? "opacity-100" : "opacity-0",
              )}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}
