import { useEffect, useMemo, useRef, useState } from "react"
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { CheckCircle2Icon, ClipboardIcon, FileClockIcon, SearchIcon, TriangleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from "@/components/ui/pagination"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
const PAGE_SIZE = 20
const AVAILABILITY_BUCKETS = 72

const formatBytes = (value?: number) => value == null ? "—" : value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`
const isFullRequest = (value: SelectedRequest): value is RequestLogView => "route" in value

function FilterSelect({ value, onChange, label, items, className }: { value: string; onChange(value: string): void; label: string; items: { value: string; label: string }[]; className?: string }) {
  const selectedLabel = items.find((item) => item.value === value)?.label ?? items[0]?.label
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger className={cn("w-36", className)} aria-label={label}><SelectValue>{selectedLabel}</SelectValue></SelectTrigger>
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

function RequestAvailability({ points, range, end, onSelect }: { points: TimelinePoint[]; range: RequestLogFilters["range"]; end: number; onSelect(point: TimelinePoint): void }) {
  const duration = range === "1h" ? 60 * 60_000 : range === "7d" ? 7 * 24 * 60 * 60_000 : 24 * 60 * 60_000
  const start = end - duration
  const bucketSize = duration / AVAILABILITY_BUCKETS
  const buckets = Array.from({ length: AVAILABILITY_BUCKETS }, (_, index) => ({ start: start + index * bucketSize, end: start + (index + 1) * bucketSize, points: [] as TimelinePoint[] }))
  for (const point of points) {
    const index = Math.floor((point.createdAt - start) / bucketSize)
    if (index >= 0 && index < buckets.length) buckets[index].points.push(point)
  }
  return (
    <Card>
      <CardHeader><CardTitle>API 可用性</CardTitle><CardDescription>从左到右按时间排列；每格汇总该时段的请求结果与平均耗时。</CardDescription></CardHeader>
      <CardContent>
        <div className="grid grid-cols-[repeat(72,minmax(0,1fr))] gap-1" role="img" aria-label="API 请求可用性阵列">
          {buckets.map((bucket) => {
            const errors = bucket.points.filter((point) => (point.statusCode ?? 0) >= 400).length
            const average = bucket.points.length ? Math.round(bucket.points.reduce((sum, point) => sum + point.durationMs, 0) / bucket.points.length) : null
            const state = bucket.points.length === 0 ? "empty" : errors === 0 ? "success" : errors === bucket.points.length ? "error" : "mixed"
            const latest = bucket.points.at(-1)
            return <Tooltip key={bucket.start}><TooltipTrigger render={<button type="button" disabled={!latest} onClick={() => latest && onSelect(latest)} aria-label={`${new Date(bucket.start).toLocaleString()}，${bucket.points.length} 个请求，${errors} 个错误`} className={cn("h-12 min-w-0 rounded-sm outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none", state === "empty" && "bg-muted", state === "success" && "bg-success/70", state === "mixed" && "bg-destructive/40", state === "error" && "bg-destructive")} />}><span className="sr-only">查看该时段请求</span></TooltipTrigger><TooltipContent><div className="flex flex-col gap-1 text-xs"><span>{new Date(bucket.start).toLocaleString()} – {new Date(bucket.end).toLocaleTimeString()}</span><span className="tabular-nums">请求 {bucket.points.length} · 错误 {errors} · 平均 {average == null ? "—" : `${average} ms`}</span></div></TooltipContent></Tooltip>
          })}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>{new Date(start).toLocaleString()}</span><div className="flex items-center gap-3"><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-success/70" />正常</span><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-destructive/40" />部分错误</span><span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-destructive" />全部错误</span></div><span>现在</span></div>
      </CardContent>
    </Card>
  )
}

function RequestDataTable({ items, newIds, onSelect }: { items: RequestLogView[]; newIds: Set<string>; onSelect(item: RequestLogView): void }) {
  const columns = useMemo<ColumnDef<RequestLogView>[]>(() => [
    { id: "status", size: 190, header: "时间与状态", cell: ({ row }) => { const item = row.original; const failed = (item.statusCode ?? 0) >= 400; return <div className={cn("grid grid-cols-[1em_5rem_2.5rem] items-center gap-2", failed && "text-destructive")}>{failed ? <TriangleAlertIcon className="size-[1em]" aria-hidden="true" /> : <CheckCircle2Icon className="size-[1em] text-success" aria-hidden="true" />}<span className="tabular-nums">{new Date(item.createdAt).toLocaleTimeString()}</span><span className="text-right tabular-nums">{item.statusCode ?? "—"}</span></div> } },
    { accessorKey: "route", size: 310, header: "路由", cell: ({ row }) => <span className="block truncate font-mono text-xs" title={row.original.route}>{row.original.route}</span> },
    { id: "account", size: 250, header: "账号", cell: ({ row }) => <span className="block truncate" title={row.original.accountLabel ?? undefined}>{row.original.accountLabel ?? "已删除或未路由"}</span> },
    { accessorKey: "durationMs", size: 110, header: () => <span className="block text-right">耗时</span>, cell: ({ row }) => <span className="block text-right tabular-nums">{row.original.durationMs == null ? "—" : `${row.original.durationMs} ms`}</span> },
    { id: "traffic", size: 160, header: () => <span className="block text-right">流量</span>, cell: ({ row }) => <span className="block text-right tabular-nums">{formatBytes(row.original.bytesIn)} / {formatBytes(row.original.bytesOut)}</span> },
  ], [])
  // TanStack returns stateful callbacks by design; this is the official Data Table integration seam.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() })
  return (
    <ScrollArea className="h-[31rem]">
      <Table className="table-fixed" style={{ minWidth: table.getTotalSize() }}>
        <TableHeader className="sticky top-0 z-10 [&_th]:bg-card">
          {table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead className="px-4" key={header.id} style={{ width: header.getSize() }}>{flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}
        </TableHeader>
        <TableBody>{table.getRowModel().rows.map((row) => <TableRow key={row.id} tabIndex={0} role="button" aria-label={`查看请求 ${row.original.requestId ?? row.original.id}`} onClick={() => onSelect(row.original)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(row.original) }} className={cn("h-11 cursor-pointer motion-reduce:transition-none", newIds.has(row.original.id) && "animate-in fade-in slide-in-from-top-1 duration-300 motion-reduce:animate-none")}>{row.getVisibleCells().map((cell) => <TableCell className="px-4" key={cell.id} style={{ width: cell.column.getSize() }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>)}</TableBody>
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
  const [filters, setFilters] = useState<RequestLogFilters>({ range: "24h", status: initialErrorsOnly ? "error" : undefined, limit: PAGE_SIZE })
  const [result, setResult] = useState(EMPTY_RESULT)
  const [availabilityEnd, setAvailabilityEnd] = useState(() => Date.now())
  const [pages, setPages] = useState<RequestLogsResponse[]>([])
  const [pageIndex, setPageIndex] = useState(0)
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
        setAvailabilityEnd(Date.now())
        setPages([next])
        setPageIndex(0)
        window.setTimeout(() => setNewIds(new Set()), 500)
      }).catch((error) => toast.add({ title: "请求日志载入失败", description: (error as Error).message, type: "error" })).finally(() => sequence === requestSequence.current && setLoading(false))
    }, revision ? 150 : 0)
    return () => window.clearTimeout(timer)
  }, [enabled, filters, revision, service])

  const update = (values: Partial<RequestLogFilters>) => setFilters((current) => ({ ...current, ...values, cursor: undefined }))
  const nextPage = async () => {
    const cached = pages[pageIndex + 1]
    if (cached) {
      setPageIndex(pageIndex + 1)
      setResult(cached)
      return
    }
    if (!result.nextCursor) return
    const next = await service.getRequestLogs({ ...filters, cursor: result.nextCursor })
    setPages((current) => [...current, next])
    setPageIndex((current) => current + 1)
    setResult(next)
  }
  const previousPage = () => {
    if (pageIndex === 0) return
    const previous = pages[pageIndex - 1]
    if (!previous) return
    setPageIndex((current) => current - 1)
    setResult(previous)
  }
  const selectTimelinePoint = (point: TimelinePoint) => setSelected(result.items.find((item) => item.id === point.id) ?? point)

  return (
    <section className="flex w-full flex-col gap-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">请求日志</h1><p className="mt-1 text-sm text-muted-foreground">使用安全的结构化元数据定位失败请求，不读取请求或响应正文。</p></div>
      <Card size="sm"><CardHeader><CardTitle>筛选请求</CardTitle><CardDescription>摘要、可用性阵列和请求列表使用相同筛选范围。</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center gap-2">
        <FilterSelect label="时间范围" value={filters.range} onChange={(range) => update({ range: range as RequestLogFilters["range"] })} items={[{ value: "1h", label: "最近 1 小时" }, { value: "24h", label: "最近 24 小时" }, { value: "7d", label: "最近 7 天" }]} />
        <FilterSelect label="结果状态" value={filters.status ?? "all"} onChange={(status) => update({ status: status === "all" ? undefined : status as "success" | "error" })} items={[{ value: "all", label: "全部结果" }, { value: "success", label: "仅成功" }, { value: "error", label: "仅错误" }]} />
        <FilterSelect label="传输类型" className="w-40" value={filters.transport ?? "all"} onChange={(transport) => update({ transport: transport === "all" ? undefined : transport as RequestLogFilters["transport"] })} items={[{ value: "all", label: "全部传输" }, { value: "http", label: "HTTP" }, { value: "ws", label: "WebSocket" }, { value: "compact", label: "压缩" }, { value: "models", label: "模型" }, { value: "search", label: "搜索" }]} />
        <AccountCombobox accounts={accounts} value={filters.accountId} onChange={(accountId) => update({ accountId })} />
        <div className="relative min-w-64 flex-1"><SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" /><Input className="pl-8" value={filters.query ?? ""} onChange={(event) => update({ query: event.target.value || undefined })} placeholder="搜索路由、请求 ID 或错误码" /></div>
      </CardContent></Card>
      <div className="grid grid-cols-3 gap-4">{[["请求数量", result.summary.requests], ["错误数量", result.summary.errors], ["平均耗时", result.summary.averageDurationMs == null ? "—" : `${Math.round(result.summary.averageDurationMs)} ms`]].map(([label, value], index) => <Card key={String(label)} size="sm"><CardHeader><CardDescription>{label}</CardDescription><CardTitle className={cn("text-2xl tabular-nums", index === 1 && Number(value) > 0 && "text-destructive")}>{value}</CardTitle></CardHeader></Card>)}</div>
      <RequestAvailability points={result.timeline ?? []} range={filters.range} end={availabilityEnd} onSelect={selectTimelinePoint} />
      <Card className="min-h-0 overflow-hidden"><CardHeader className="border-b"><CardTitle>请求记录</CardTitle><CardDescription>按时间倒序显示，选择一行查看允许记录的完整元数据。</CardDescription></CardHeader><CardContent className="p-0">
        {!enabled || (!loading && result.items.length === 0) ? <Empty className="min-h-80 border-0"><EmptyHeader><EmptyMedia variant="icon"><FileClockIcon /></EmptyMedia><EmptyTitle>{enabled ? "没有匹配的请求记录" : "请求元数据记录已关闭"}</EmptyTitle><EmptyDescription>{enabled ? "调整筛选条件后重试。" : "启用后只记录状态、耗时和路由等安全元数据。"}</EmptyDescription></EmptyHeader>{!enabled && <EmptyContent><Button variant="outline" onClick={onShowPreferences}>前往偏好设置</Button></EmptyContent>}</Empty> : <RequestDataTable items={result.items} newIds={newIds} onSelect={setSelected} />}
      </CardContent>{(pageIndex > 0 || result.nextCursor) && <CardFooter className="border-t py-3"><Pagination aria-label="请求日志分页"><PaginationContent><PaginationItem><PaginationPrevious href="#" text="上一页" aria-label="上一页" aria-disabled={pageIndex === 0} className={cn(pageIndex === 0 && "pointer-events-none opacity-50")} onClick={(event) => { event.preventDefault(); previousPage() }} /></PaginationItem><PaginationItem><span className="flex h-8 items-center px-3 text-sm tabular-nums">第 {pageIndex + 1} 页</span></PaginationItem><PaginationItem><PaginationNext href="#" text="下一页" aria-label="下一页" aria-disabled={!result.nextCursor && !pages[pageIndex + 1]} className={cn(!result.nextCursor && !pages[pageIndex + 1] && "pointer-events-none opacity-50")} onClick={(event) => { event.preventDefault(); void nextPage() }} /></PaginationItem></PaginationContent></Pagination></CardFooter>}</Card>
      <RequestDetailSheet selected={selected} onClose={() => setSelected(null)} />
    </section>
  )
}
