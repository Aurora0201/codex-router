import { useEffect, useMemo, useRef, useState } from "react"
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { CartesianGrid, Scatter, ScatterChart, XAxis, YAxis } from "recharts"
import { CheckCircle2Icon, ClipboardIcon, FileClockIcon, SearchIcon, TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import type { AccountView, GatewayService, RequestLogFilters, RequestLogsResponse, RequestLogView } from "@/services/contracts"

type TimelinePoint = RequestLogsResponse["timeline"][number]
type SelectedRequest = RequestLogView | TimelinePoint
type AccountOption = { value: string; label: string }

const EMPTY_RESULT: RequestLogsResponse = {
  items: [],
  summary: { requests: 0, errors: 0, averageDurationMs: null },
  timeline: [],
  nextCursor: null,
}
const CHART_CONFIG = {
  success: { label: "成功", color: "var(--success)" },
  error: { label: "错误", color: "var(--color-destructive)" },
} satisfies ChartConfig

const formatBytes = (value?: number) => value == null ? "—" : value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`
const isFullRequest = (value: SelectedRequest): value is RequestLogView => "route" in value

function FilterSelect({ value, onChange, label, items, className }: { value: string; onChange(value: string): void; label: string; items: { value: string; label: string }[]; className?: string }) {
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger className={cn("w-36", className)} aria-label={label}><SelectValue /></SelectTrigger>
      <SelectContent><SelectGroup>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent>
    </Select>
  )
}

function AccountCombobox({ accounts, value, onChange }: { accounts: AccountView[]; value?: string; onChange(value?: string): void }) {
  const options = useMemo<AccountOption[]>(() => [
    { value: "all", label: "全部账号" },
    ...accounts.map((account) => ({ value: account.id, label: account.email ?? account.chatgptAccountId ?? account.id })),
  ], [accounts])
  const selected = options.find((option) => option.value === (value ?? "all")) ?? options[0]
  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(option) => onChange(option?.value === "all" ? undefined : option?.value)}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
    >
      <ComboboxInput className="w-56" placeholder="搜索账号邮箱" aria-label="账号筛选" />
      <ComboboxContent className="min-w-80">
        <ComboboxEmpty>没有匹配的账号</ComboboxEmpty>
        <ComboboxList>{(option: AccountOption) => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function RequestTimeline({ points, onSelect }: { points: TimelinePoint[]; onSelect(point: TimelinePoint): void }) {
  const success = points.filter((point) => (point.statusCode ?? 0) < 400)
  const errors = points.filter((point) => (point.statusCode ?? 0) >= 400)
  const renderTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload?: TimelinePoint }> }) => {
    const point = payload?.[0]?.payload
    if (!active || !point) return null
    return <ChartTooltipContent active payload={payload as never} hideLabel hideIndicator formatter={() => <div className="flex min-w-40 flex-col gap-1"><span>{new Date(point.createdAt).toLocaleString()}</span><span className={cn("tabular-nums", (point.statusCode ?? 0) >= 400 && "text-destructive")}>状态 {point.statusCode ?? "—"} · {point.durationMs.toLocaleString()} ms</span></div>} />
  }
  return (
    <Card>
      <CardHeader><CardTitle>请求耗时分布</CardTitle><CardDescription>每个点代表一次请求；横轴为时间，纵轴为耗时。</CardDescription></CardHeader>
      <CardContent>
        {points.length === 0 ? <Empty className="h-64 border-0"><EmptyHeader><EmptyMedia variant="icon"><FileClockIcon /></EmptyMedia><EmptyTitle>暂无可绘制的耗时数据</EmptyTitle><EmptyDescription>没有耗时数据的请求仍会显示在下方列表中。</EmptyDescription></EmptyHeader></Empty> : (
          <ChartContainer config={CHART_CONFIG} className="h-72 w-full aspect-auto" role="img" aria-label="请求耗时散点图">
            <ScatterChart margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis type="number" dataKey="createdAt" domain={["dataMin", "dataMax"]} tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} tickLine={false} axisLine={false} minTickGap={48} />
              <YAxis type="number" dataKey="durationMs" width={64} tickFormatter={(value) => `${value} ms`} tickLine={false} axisLine={false} />
              <ChartTooltip cursor={{ stroke: "var(--border)" }} content={renderTooltip as never} />
              <Scatter name="成功" data={success} fill="var(--color-success)" onClick={(point) => onSelect((point as { payload: TimelinePoint }).payload)} />
              <Scatter name="错误" data={errors} fill="var(--color-error)" onClick={(point) => onSelect((point as { payload: TimelinePoint }).payload)} />
            </ScatterChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

function RequestDataTable({ items, newIds, onSelect }: { items: RequestLogView[]; newIds: Set<string>; onSelect(item: RequestLogView): void }) {
  const columns = useMemo<ColumnDef<RequestLogView>[]>(() => [
    { id: "status", size: 180, header: "时间与状态", cell: ({ row }) => { const item = row.original; const failed = (item.statusCode ?? 0) >= 400; return <div className={cn("flex items-center gap-2", failed && "text-destructive")}>{failed ? <TriangleAlertIcon aria-hidden="true" /> : <CheckCircle2Icon className="text-success" aria-hidden="true" />}<span className="tabular-nums">{new Date(item.createdAt).toLocaleTimeString()}</span><span className="tabular-nums">{item.statusCode ?? "—"}</span></div> } },
    { accessorKey: "route", size: 360, header: "路由", cell: ({ row }) => <span className="block truncate font-mono text-xs">{row.original.route}</span> },
    { id: "account", size: 220, header: "账号", cell: ({ row }) => <span className="block truncate" title={row.original.accountLabel ?? undefined}>{row.original.accountLabel ?? "已删除或未路由"}</span> },
    { accessorKey: "durationMs", size: 110, header: () => <span className="block text-right">耗时</span>, cell: ({ row }) => <span className="block text-right tabular-nums">{row.original.durationMs == null ? "—" : `${row.original.durationMs} ms`}</span> },
    { id: "traffic", size: 160, header: () => <span className="block text-right">流量</span>, cell: ({ row }) => <span className="block text-right tabular-nums">{formatBytes(row.original.bytesIn)} / {formatBytes(row.original.bytesOut)}</span> },
  ], [])
  // TanStack returns stateful callbacks by design; this is the official Data Table integration seam.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() })
  return (
    <ScrollArea className="h-[clamp(26rem,calc(100dvh-28rem),44rem)]">
      <Table className="table-fixed" style={{ minWidth: table.getTotalSize() }}>
        <TableHeader className="sticky top-0 bg-card">
          {table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead key={header.id} style={{ width: header.getSize() }}>{flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}
        </TableHeader>
        <TableBody>{table.getRowModel().rows.map((row) => <TableRow key={row.id} tabIndex={0} role="button" aria-label={`查看请求 ${row.original.requestId ?? row.original.id}`} onClick={() => onSelect(row.original)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(row.original) }} className={cn("cursor-pointer motion-reduce:transition-none", newIds.has(row.original.id) && "animate-in fade-in slide-in-from-top-1 duration-300 motion-reduce:animate-none")}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id} style={{ width: cell.column.getSize() }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  )
}

function RequestDetailSheet({ selected, onClose }: { selected: SelectedRequest | null; onClose(): void }) {
  if (!selected) return <Sheet open={false} />
  const full = isFullRequest(selected)
  const requestId = full ? selected.requestId : undefined
  const groups = [
    { title: "结果", values: [["时间", new Date(selected.createdAt).toLocaleString()], ["状态码", selected.statusCode ?? "—"], ["错误码", full ? selected.errorCode ?? "—" : "请在请求列表中查看"]] },
    ...(full ? [{ title: "路由", values: [["路径", selected.route], ["传输类型", selected.transport], ["账号", selected.accountLabel ?? "已删除或未路由"]] }] : []),
    { title: "性能", values: [["耗时", `${selected.durationMs?.toLocaleString() ?? "—"} ms`], ...(full ? [["输入 / 输出", `${formatBytes(selected.bytesIn)} / ${formatBytes(selected.bytesOut)}`]] : [])] },
    ...(full ? [{ title: "请求标识", values: [["请求 ID", requestId ?? "未提供"]] }] : []),
  ]
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader className="border-b"><SheetTitle>请求详情</SheetTitle><SheetDescription>仅包含允许记录的诊断元数据。</SheetDescription></SheetHeader>
        <ScrollArea className="min-h-0 flex-1"><div className="flex flex-col gap-6 px-4 pb-4">{groups.map((group) => <section key={group.title} className="flex flex-col gap-3"><h3 className="text-sm font-medium">{group.title}</h3>{group.values.map(([label, value]) => <div key={String(label)} className="grid grid-cols-[7rem_1fr] gap-3"><span className="text-sm text-muted-foreground">{label}</span><span className={cn("min-w-0 break-all text-sm", label === "路径" || label === "请求 ID" ? "font-mono" : "tabular-nums")}>{value}</span></div>)}</section>)}</div></ScrollArea>
        <SheetFooter className="border-t sm:flex-row sm:justify-end">
          {requestId && <Button variant="outline" onClick={() => void navigator.clipboard.writeText(requestId).then(() => toast.add({ title: "请求 ID 已复制" }))}><ClipboardIcon data-icon="inline-start" />复制请求 ID</Button>}
          <SheetClose render={<Button variant="default" />}>关闭</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function RequestLogsPage({ service, accounts, enabled, initialErrorsOnly, revision, onShowPreferences }: { service: GatewayService; accounts: AccountView[]; enabled: boolean; initialErrorsOnly: boolean; revision: number; onShowPreferences(): void }) {
  const [filters, setFilters] = useState<RequestLogFilters>({ range: "24h", status: initialErrorsOnly ? "error" : undefined, limit: 50 })
  const [result, setResult] = useState(EMPTY_RESULT)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<SelectedRequest | null>(null)
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
  const selectTimelinePoint = (point: TimelinePoint) => setSelected(result.items.find((item) => item.id === point.id) ?? point)

  return (
    <section className="flex w-full flex-col gap-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">请求日志</h1><p className="mt-1 text-sm text-muted-foreground">使用安全的结构化元数据定位失败请求，不读取请求或响应正文。</p></div>
      <Card size="sm"><CardHeader><CardTitle>筛选请求</CardTitle><CardDescription>摘要、耗时图和请求列表使用相同筛选范围。</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center gap-2">
        <FilterSelect label="时间范围" value={filters.range} onChange={(range) => update({ range: range as RequestLogFilters["range"] })} items={[{ value: "1h", label: "最近 1 小时" }, { value: "24h", label: "最近 24 小时" }, { value: "7d", label: "最近 7 天" }]} />
        <FilterSelect label="结果状态" value={filters.status ?? "all"} onChange={(status) => update({ status: status === "all" ? undefined : status as "success" | "error" })} items={[{ value: "all", label: "全部结果" }, { value: "success", label: "仅成功" }, { value: "error", label: "仅错误" }]} />
        <FilterSelect label="传输类型" className="w-40" value={filters.transport ?? "all"} onChange={(transport) => update({ transport: transport === "all" ? undefined : transport as RequestLogFilters["transport"] })} items={[{ value: "all", label: "全部传输" }, { value: "http", label: "HTTP" }, { value: "ws", label: "WebSocket" }, { value: "compact", label: "压缩" }, { value: "models", label: "模型" }, { value: "search", label: "搜索" }]} />
        <AccountCombobox accounts={accounts} value={filters.accountId} onChange={(accountId) => update({ accountId })} />
        <div className="relative min-w-64 flex-1"><SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" /><Input className="pl-8" value={filters.query ?? ""} onChange={(event) => update({ query: event.target.value || undefined })} placeholder="搜索路由、请求 ID 或错误码" /></div>
      </CardContent></Card>
      <div className="grid grid-cols-3 gap-4">{[["请求数量", result.summary.requests], ["错误数量", result.summary.errors], ["平均耗时", result.summary.averageDurationMs == null ? "—" : `${Math.round(result.summary.averageDurationMs)} ms`]].map(([label, value], index) => <Card key={String(label)} size="sm"><CardHeader><CardDescription>{label}</CardDescription><CardTitle className={cn("text-2xl tabular-nums", index === 1 && Number(value) > 0 && "text-destructive")}>{value}</CardTitle></CardHeader></Card>)}</div>
      <RequestTimeline points={result.timeline ?? []} onSelect={selectTimelinePoint} />
      <Card className="min-h-0 overflow-hidden"><CardHeader className="border-b"><CardTitle>请求记录</CardTitle><CardDescription>按时间倒序显示，选择一行查看允许记录的完整元数据。</CardDescription></CardHeader><CardContent className="p-0">
        {!enabled || (!loading && result.items.length === 0) ? <Empty className="min-h-80 border-0"><EmptyHeader><EmptyMedia variant="icon"><FileClockIcon /></EmptyMedia><EmptyTitle>{enabled ? "没有匹配的请求记录" : "请求元数据记录已关闭"}</EmptyTitle><EmptyDescription>{enabled ? "调整筛选条件后重试。" : "启用后只记录状态、耗时和路由等安全元数据。"}</EmptyDescription></EmptyHeader>{!enabled && <EmptyContent><Button variant="outline" onClick={onShowPreferences}>前往偏好设置</Button></EmptyContent>}</Empty> : <RequestDataTable items={result.items} newIds={newIds} onSelect={setSelected} />}
      </CardContent>{result.nextCursor && <CardFooter className="justify-center border-t py-3"><Button variant="outline" onClick={() => void loadMore()}>加载更多</Button></CardFooter>}</Card>
      <RequestDetailSheet selected={selected} onClose={() => setSelected(null)} />
    </section>
  )
}
