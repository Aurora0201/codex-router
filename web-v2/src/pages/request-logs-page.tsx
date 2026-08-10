import { useEffect, useRef, useState } from "react"
import { CheckCircle2Icon, ClipboardIcon, FileClockIcon, SearchIcon, TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import type { AccountView, GatewayService, RequestLogFilters, RequestLogsResponse, RequestLogView } from "@/services/contracts"

const EMPTY_RESULT: RequestLogsResponse = { items: [], summary: { requests: 0, errors: 0, averageDurationMs: null }, nextCursor: null }
const formatBytes = (value?: number) => value == null ? "—" : value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`

function FilterSelect({ value, onChange, label, items }: { value: string; onChange(value: string): void; label: string; items: { value: string; label: string }[] }) {
  return <Select value={value} onValueChange={(next) => next && onChange(next)}><SelectTrigger className="w-36" aria-label={label}><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
}

export function RequestLogsPage({ service, accounts, enabled, initialErrorsOnly, revision, onShowPreferences }: {
  service: GatewayService
  accounts: AccountView[]
  enabled: boolean
  initialErrorsOnly: boolean
  revision: number
  onShowPreferences(): void
}) {
  const [filters, setFilters] = useState<RequestLogFilters>({ range: "24h", status: initialErrorsOnly ? "error" : undefined, limit: 50 })
  const [result, setResult] = useState(EMPTY_RESULT)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<RequestLogView | null>(null)
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const knownIds = useRef(new Set<string>())
  const requestSequence = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const sequence = ++requestSequence.current
    const timer = window.setTimeout(() => {
      setLoading(true)
      void service.getRequestLogs({ ...filters, cursor: undefined }).then((next) => {
        if (sequence !== requestSequence.current) return
        const incoming = new Set(next.items.filter((item) => !knownIds.current.has(item.id)).map((item) => item.id))
        knownIds.current = new Set(next.items.map((item) => item.id))
        setNewIds(incoming)
        setResult(next)
        window.setTimeout(() => setNewIds(new Set()), 500)
      }).catch((error) => toast.add({ title: "请求日志载入失败", description: (error as Error).message, type: "error" })).finally(() => sequence === requestSequence.current && setLoading(false))
    }, revision ? 150 : 0)
    return () => window.clearTimeout(timer)
  }, [enabled, filters, revision, service])

  const update = (values: Partial<RequestLogFilters>) => setFilters((current) => ({ ...current, ...values, cursor: undefined }))
  const loadMore = async () => {
    if (!result.nextCursor) return
    const next = await service.getRequestLogs({ ...filters, cursor: result.nextCursor })
    setResult((current) => ({ ...next, items: [...current.items, ...next.items] }))
  }

  return <section className="flex w-full flex-col gap-5">
    <div><h1 className="text-2xl font-semibold tracking-tight">请求日志</h1><p className="mt-1 text-sm text-muted-foreground">使用安全的结构化元数据定位失败请求，不读取请求或响应正文。</p></div>
    <div className="grid grid-cols-3 gap-4">
      {[["请求数量", result.summary.requests], ["错误数量", result.summary.errors], ["平均耗时", result.summary.averageDurationMs == null ? "—" : `${Math.round(result.summary.averageDurationMs)} ms`]].map(([label, value], index) => <Card key={String(label)} size="sm"><CardHeader><CardDescription>{label}</CardDescription><CardTitle className={cn("text-2xl tabular-nums", index === 1 && Number(value) > 0 && "text-destructive")}>{value}</CardTitle></CardHeader></Card>)}
    </div>
    <Card className="min-h-0 overflow-hidden">
      <CardHeader className="border-b"><CardTitle>请求记录</CardTitle><CardDescription>默认显示最近 24 小时，可组合筛选。</CardDescription><div className="col-span-full mt-3 flex flex-wrap gap-2">
        <FilterSelect label="时间范围" value={filters.range} onChange={(range) => update({ range: range as RequestLogFilters["range"] })} items={[{value:"1h",label:"最近 1 小时"},{value:"24h",label:"最近 24 小时"},{value:"7d",label:"最近 7 天"}]} />
        <FilterSelect label="结果状态" value={filters.status ?? "all"} onChange={(status) => update({ status: status === "all" ? undefined : status as "success"|"error" })} items={[{value:"all",label:"全部结果"},{value:"success",label:"仅成功"},{value:"error",label:"仅错误"}]} />
        <FilterSelect label="传输类型" value={filters.transport ?? "all"} onChange={(transport) => update({ transport: transport === "all" ? undefined : transport as RequestLogFilters["transport"] })} items={[{value:"all",label:"全部 transport"},{value:"http",label:"HTTP"},{value:"ws",label:"WebSocket"},{value:"compact",label:"Compact"},{value:"models",label:"Models"},{value:"search",label:"Search"}]} />
        <FilterSelect label="账号" value={filters.accountId ?? "all"} onChange={(accountId) => update({ accountId: accountId === "all" ? undefined : accountId })} items={[{value:"all",label:"全部账号"},...accounts.map((account) => ({value:account.id,label:account.email ?? account.chatgptAccountId ?? account.id}))]} />
        <div className="relative min-w-64 flex-1"><SearchIcon className="pointer-events-none absolute left-2.5 top-2 size-4 text-muted-foreground" /><Input className="pl-8" value={filters.query ?? ""} onChange={(event) => update({ query: event.target.value || undefined })} placeholder="搜索路由、请求 ID 或错误码" /></div>
      </div></CardHeader>
      <CardContent className="p-0">
        {!enabled || (!loading && result.items.length === 0) ? <Empty className="min-h-80 border-0"><EmptyHeader><EmptyMedia variant="icon"><FileClockIcon /></EmptyMedia><EmptyTitle>{enabled ? "没有匹配的请求记录" : "请求元数据记录已关闭"}</EmptyTitle><EmptyDescription>{enabled ? "调整筛选条件后重试。" : "启用后只记录状态、耗时和路由等安全元数据。"}</EmptyDescription></EmptyHeader>{!enabled && <EmptyContent><Button variant="outline" onClick={onShowPreferences}>前往偏好设置</Button></EmptyContent>}</Empty> : <div className="max-h-[clamp(28rem,calc(100dvh-25rem),48rem)] overflow-auto"><Table><TableHeader className="sticky top-0 z-10 bg-card"><TableRow><TableHead>时间与状态</TableHead><TableHead>路由</TableHead><TableHead>账号</TableHead><TableHead className="text-right">耗时</TableHead><TableHead className="text-right">流量</TableHead></TableRow></TableHeader><TableBody>{result.items.map((item) => { const failed = (item.statusCode ?? 0) >= 400; return <TableRow key={item.id} tabIndex={0} role="button" aria-label={`查看请求 ${item.requestId ?? item.id}`} onClick={() => setSelected(item)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelected(item) }} className={cn("cursor-pointer motion-reduce:transition-none", newIds.has(item.id) && "animate-in fade-in slide-in-from-top-1 duration-300 motion-reduce:animate-none")}><TableCell><div className={cn("flex items-center gap-2", failed && "text-destructive")}>{failed ? <TriangleAlertIcon className="size-4" /> : <CheckCircle2Icon className="size-4 text-success" />}<span className="tabular-nums">{new Date(item.createdAt).toLocaleTimeString()}</span><span>{item.statusCode ?? "—"}</span></div></TableCell><TableCell className="max-w-72 truncate font-mono text-xs">{item.route}</TableCell><TableCell className="max-w-56 truncate">{item.accountLabel ?? "已删除或未路由"}</TableCell><TableCell className="text-right tabular-nums">{item.durationMs == null ? "—" : `${item.durationMs} ms`}</TableCell><TableCell className="text-right tabular-nums">{formatBytes(item.bytesIn)} / {formatBytes(item.bytesOut)}</TableCell></TableRow> })}</TableBody></Table>{result.nextCursor && <div className="flex justify-center border-t p-3"><Button variant="outline" onClick={() => void loadMore()}>加载更多</Button></div>}</div>}
      </CardContent>
    </Card>
    <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}><SheetContent className="sm:max-w-md"><SheetHeader><SheetTitle>请求详情</SheetTitle><SheetDescription>仅包含允许记录的诊断元数据。</SheetDescription></SheetHeader>{selected && <div className="grid gap-4 px-4">{[["请求 ID",selected.requestId ?? "未提供"],["时间",new Date(selected.createdAt).toLocaleString()],["状态码",selected.statusCode ?? "—"],["错误码",selected.errorCode ?? "—"],["路由",selected.route],["Transport",selected.transport],["账号",selected.accountLabel ?? "已删除或未路由"],["耗时",selected.durationMs == null ? "—" : `${selected.durationMs} ms`],["输入 / 输出",`${formatBytes(selected.bytesIn)} / ${formatBytes(selected.bytesOut)}`]].map(([label,value]) => <div key={String(label)}><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 break-all font-mono text-sm">{value}</div></div>)}{selected.requestId && <Button variant="outline" onClick={() => void navigator.clipboard.writeText(selected.requestId!).then(() => toast.add({title:"请求 ID 已复制"}))}><ClipboardIcon data-icon="inline-start" />复制请求 ID</Button>}</div>}</SheetContent></Sheet>
  </section>
}
