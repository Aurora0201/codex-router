import { useEffect, useMemo, useRef, useState } from "react"
import { type ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { BanIcon, CheckCircle2Icon, CircleMinusIcon, ClipboardIcon, FileClockIcon, SearchIcon, TriangleAlertIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "@/components/ui/combobox"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import { cn } from "@/lib/utils"
import type { AccountView, GatewayService, RequestLogFilters, RequestLogsResponse, RequestLogView, RequestOutcome } from "@/services/contracts"

type TimelinePoint = RequestLogsResponse["timeline"][number]
type SelectedRequest = RequestLogView | TimelinePoint
type AccountOption = { value: string; label: string }

const PAGE_SIZE = 20
const EMPTY_RESULT: RequestLogsResponse = {
  items: [],
  summary: { requests: 0, errors: 0, rejected: 0, cancelled: 0, availabilityRequests: 0, availabilityErrors: 0, averageDurationMs: null },
  timeline: [],
  nextCursor: null,
  pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 0 },
}

const formatBytes = (value?: number) => value == null ? "—" : value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`
const isFullRequest = (value: SelectedRequest): value is RequestLogView => "route" in value

const OUTCOME_LABELS: Record<RequestOutcome, string> = {
  success: "成功",
  rejected: "已拒绝",
  upstream_error: "上游故障",
  gateway_error: "网关故障",
  client_cancelled: "已取消",
}

function OutcomeBadge({ outcome }: { outcome: RequestOutcome }) {
  const { t } = useTranslation()
  const Icon = outcome === "success" ? CheckCircle2Icon : outcome === "client_cancelled" ? BanIcon : outcome === "rejected" ? CircleMinusIcon : TriangleAlertIcon
  return <Badge variant="outline" className={cn(outcome === "success" && "text-success", outcome === "rejected" && "text-warning", (outcome === "upstream_error" || outcome === "gateway_error") && "text-destructive", outcome === "client_cancelled" && "text-muted-foreground")}><Icon data-icon="inline-start" />{t(OUTCOME_LABELS[outcome])}</Badge>
}

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
  const { t } = useTranslation()
  const options = useMemo<AccountOption[]>(() => [
    { value: "all", label: t("全部账号") },
    { value: "__client_passthrough__", label: t("Codex 默认账号") },
    ...accounts.map((account) => ({ value: account.id, label: account.email ?? account.chatgptAccountId ?? account.id })),
  ], [accounts, t])
  const selected = options.find((option) => option.value === (value ?? "all")) ?? options[0]
  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(option) => onChange(option?.value === "all" ? undefined : option?.value)}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
    >
      <ComboboxInput className="w-56" placeholder={t("搜索账号邮箱")} aria-label={t("账号筛选")} />
      <ComboboxContent className="min-w-80">
        <ComboboxEmpty>{t("没有匹配的账号")}</ComboboxEmpty>
        <ComboboxList>{(option: AccountOption) => <ComboboxItem key={option.value} value={option}>{option.label}</ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function RequestDataTable({ items, newIds, page, onSelect }: { items: RequestLogView[]; newIds: Set<string>; page: number; onSelect(item: RequestLogView): void }) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]")
    if (!viewport) return
    if (typeof viewport.scrollTo === "function") viewport.scrollTo({ top: 0 })
    else viewport.scrollTop = 0
  }, [page])
  const columns = useMemo<ColumnDef<RequestLogView>[]>(() => [
    { id: "status", size: 250, header: t("时间与状态"), cell: ({ row }) => { const item = row.original; return <div className="flex items-center gap-2"><span className="w-20 tabular-nums">{new Date(item.createdAt).toLocaleTimeString(locale)}</span><OutcomeBadge outcome={item.outcome} /><span className="tabular-nums text-muted-foreground">{item.statusCode ?? "—"}</span></div> } },
    { accessorKey: "route", size: 310, header: t("路由"), cell: ({ row }) => <span className="block truncate font-mono text-xs" title={row.original.route}>{row.original.route}</span> },
    { id: "account", size: 250, header: t("账号"), cell: ({ row }) => { const label = row.original.identityMode === "client_passthrough" ? t("Codex 默认账号") : row.original.accountLabel ?? t("已删除或未路由"); return <span className="block truncate" title={label}>{label}</span> } },
    { accessorKey: "durationMs", size: 110, header: t("耗时"), cell: ({ row }) => <span className="block tabular-nums">{row.original.durationMs == null ? "—" : `${row.original.durationMs} ms`}</span> },
    { id: "traffic", size: 160, header: t("流量"), cell: ({ row }) => <span className="block tabular-nums">{formatBytes(row.original.bytesIn)} / {formatBytes(row.original.bytesOut)}</span> },
  ], [locale, t])
  // TanStack returns stateful callbacks by design; this is the official Data Table integration seam.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: items, columns, getCoreRowModel: getCoreRowModel() })
  return (
    <ScrollArea ref={scrollAreaRef} className="h-[31rem] [&_[data-slot=table-container]]:overflow-visible">
      <Table className="table-fixed" style={{ minWidth: table.getTotalSize() }}>
        <TableHeader className="sticky top-0 z-10 [&_tr]:shadow-sm [&_th]:bg-card">
          {table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead className="h-11 px-4 py-0 align-middle" key={header.id} style={{ width: header.getSize() }}>{flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}
        </TableHeader>
        <TableBody>{table.getRowModel().rows.map((row) => <TableRow key={row.id} tabIndex={0} role="button" aria-label={t("查看请求 {{id}}", { id: row.original.requestId ?? row.original.id })} onClick={() => onSelect(row.original)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(row.original) }} className={cn("h-11 cursor-pointer motion-reduce:transition-none", newIds.has(row.original.id) && "animate-in fade-in slide-in-from-top-1 duration-300 motion-reduce:animate-none")}>{row.getVisibleCells().map((cell) => <TableCell className="px-4" key={cell.id} style={{ width: cell.column.getSize() }}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  )
}

type PaginationToken = number | "start-ellipsis" | "end-ellipsis"

function paginationTokens(page: number, totalPages: number): PaginationToken[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1)
  if (page <= 4) return [1, 2, 3, 4, 5, "end-ellipsis", totalPages]
  if (page >= totalPages - 3) return [1, "start-ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  return [1, "start-ellipsis", page - 1, page, page + 1, "end-ellipsis", totalPages]
}

function RequestDetailSheet({ selected, onClose }: { selected: SelectedRequest | null; onClose(): void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  if (!selected) return <Sheet open={false} />
  const full = isFullRequest(selected)
  const requestId = full ? selected.requestId : undefined
  const groups = [
    { title: t("结果"), values: [[t("时间"), new Date(selected.createdAt).toLocaleString(locale)], [t("结果"), t(OUTCOME_LABELS[selected.outcome])], [t("状态码"), selected.statusCode ?? "—"], [t("错误码"), full ? selected.errorCode ?? "—" : t("请在请求列表中查看")]] },
    ...(full ? [{ title: t("路由"), values: [[t("路径"), selected.route], [t("传输类型"), selected.transport], [t("记录范围"), selected.scope === "request" ? t("请求") : t("连接")], [t("账号"), selected.identityMode === "client_passthrough" ? t("Codex 默认账号") : selected.accountLabel ?? t("已删除或未路由")]] }] : []),
    { title: t("性能"), values: [[t("耗时"), `${selected.durationMs?.toLocaleString(locale) ?? "—"} ms`], ...(full ? [[t("输入 / 输出"), `${formatBytes(selected.bytesIn)} / ${formatBytes(selected.bytesOut)}`]] : [])] },
    ...(full ? [{ title: t("请求标识"), values: [[t("请求 ID"), requestId ?? t("未提供")]] }] : []),
  ]
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader className="border-b"><SheetTitle>{t("请求详情")}</SheetTitle><SheetDescription>{t("仅包含允许记录的诊断元数据。")}</SheetDescription></SheetHeader>
        <ScrollArea className="min-h-0 flex-1"><div className="flex flex-col gap-6 px-4 pb-4">{groups.map((group) => <section key={group.title} className="flex flex-col gap-3"><h3 className="text-sm font-medium">{group.title}</h3>{group.values.map(([label, value]) => <div key={String(label)} className="grid grid-cols-[7rem_1fr] gap-3"><span className="text-sm text-muted-foreground">{label}</span><span className={cn("min-w-0 break-all text-sm", label === t("路径") || label === t("请求 ID") ? "font-mono" : "tabular-nums")}>{value}</span></div>)}</section>)}</div></ScrollArea>
        <SheetFooter className="border-t sm:flex-row sm:justify-end">
          {requestId && <Button variant="outline" onClick={() => void navigator.clipboard.writeText(requestId).then(() => toast.add({ title: t("请求 ID 已复制") }))}><ClipboardIcon data-icon="inline-start" />{t("复制请求 ID")}</Button>}
          <SheetClose render={<Button variant="default" />}>{t("关闭")}</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function RequestLogsPage({ service, accounts, enabled, initialErrorsOnly, revision, onShowPreferences }: { service: GatewayService; accounts: AccountView[]; enabled: boolean; initialErrorsOnly: boolean; revision: number; onShowPreferences(): void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  const [filters, setFilters] = useState<RequestLogFilters>({ range: "24h", status: initialErrorsOnly ? "error" : undefined, page: 1, limit: PAGE_SIZE })
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
        if (next.pagination.page !== filters.page) {
          setFilters((current) => ({ ...current, page: next.pagination.page }))
        }
        window.setTimeout(() => setNewIds(new Set()), 500)
      }).catch((error) => toast.add({ title: t("请求日志载入失败"), description: (error as Error).message, type: "error" })).finally(() => sequence === requestSequence.current && setLoading(false))
    }, revision ? 150 : 0)
    return () => window.clearTimeout(timer)
  }, [enabled, filters, revision, service, t])

  const update = (values: Partial<RequestLogFilters>) => setFilters((current) => ({ ...current, ...values, cursor: undefined, page: 1 }))
  const goToPage = (page: number) => {
    if (loading || page < 1 || page > result.pagination.totalPages || page === result.pagination.page) return
    setFilters((current) => ({ ...current, cursor: undefined, page }))
  }

  return (
    <section className="flex w-full flex-col gap-5">
      <div><h1 className="text-2xl font-semibold tracking-tight">{t("请求日志")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("使用安全的结构化元数据定位失败请求，不读取请求或响应正文。")}</p></div>
      <Card><CardHeader><CardTitle>{t("筛选请求")}</CardTitle><CardDescription>{t("摘要和请求列表使用相同筛选范围。")}</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center gap-2">
        <FilterSelect label={t("时间范围")} value={filters.range} onChange={(range) => update({ range: range as RequestLogFilters["range"] })} items={[{ value: "1h", label: t("最近 1 小时") }, { value: "24h", label: t("最近 24 小时") }, { value: "7d", label: t("最近 7 天") }]} />
        <FilterSelect label={t("结果状态")} value={filters.status ?? "all"} onChange={(status) => update({ status: status === "all" ? undefined : status as RequestLogFilters["status"] })} items={[{ value: "all", label: t("全部结果") }, { value: "success", label: t("仅成功") }, { value: "rejected", label: t("仅拒绝") }, { value: "error", label: t("仅故障") }, { value: "cancelled", label: t("仅取消") }]} />
        <FilterSelect label={t("传输类型")} className="w-40" value={filters.transport ?? "all"} onChange={(transport) => update({ transport: transport === "all" ? undefined : transport as RequestLogFilters["transport"] })} items={[{ value: "all", label: t("全部传输") }, { value: "http", label: "HTTP" }, { value: "ws", label: "WebSocket" }, { value: "compact", label: t("压缩") }, { value: "models", label: t("模型") }, { value: "search", label: t("搜索") }]} />
        <AccountCombobox accounts={accounts} value={filters.accountId} onChange={(accountId) => update({ accountId })} />
        <div className="relative min-w-64 flex-1"><SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" /><Input className="pl-8" value={filters.query ?? ""} onChange={(event) => update({ query: event.target.value || undefined })} placeholder={t("搜索路由、请求 ID 或错误码")} /></div>
      </CardContent></Card>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[[t("请求数量"), result.summary.requests.toLocaleString(locale)], [t("故障数量"), result.summary.errors.toLocaleString(locale)], [t("取消数量"), result.summary.cancelled.toLocaleString(locale)], [t("平均耗时"), result.summary.averageDurationMs == null ? "—" : `${Math.round(result.summary.averageDurationMs).toLocaleString(locale)} ms`]].map(([label, value], index) => <Card key={String(label)} size="sm"><CardHeader><CardDescription>{label}</CardDescription><CardTitle className={cn("text-2xl tabular-nums", index === 1 && Number(value) > 0 && "text-destructive", index === 2 && Number(value) > 0 && "text-muted-foreground")}>{value}</CardTitle></CardHeader></Card>)}</div>
      <Card className="min-h-0 gap-0 overflow-hidden"><CardHeader className="border-b"><CardTitle>{t("请求记录")}</CardTitle><CardDescription>{t("按时间倒序显示，选择一行查看允许记录的完整元数据。")}</CardDescription></CardHeader><CardContent className="p-0">
        {!enabled || (!loading && result.items.length === 0) ? <Empty className="min-h-80 border-0"><EmptyHeader><EmptyMedia variant="icon"><FileClockIcon /></EmptyMedia><EmptyTitle>{enabled ? t("没有匹配的请求记录") : t("请求元数据记录已关闭")}</EmptyTitle><EmptyDescription>{enabled ? t("调整筛选条件后重试。") : t("启用后只记录状态、耗时和路由等安全元数据。")}</EmptyDescription></EmptyHeader>{!enabled && <EmptyContent><Button variant="outline" onClick={onShowPreferences}>{t("前往偏好设置")}</Button></EmptyContent>}</Empty> : <RequestDataTable items={result.items} newIds={newIds} page={result.pagination.page} onSelect={setSelected} />}
      </CardContent>{result.pagination.totalPages > 0 && <CardFooter className="justify-between py-3"><span className="text-sm text-muted-foreground tabular-nums">{t("共 {{total}} 条 · 每页 {{size}} 条", { total: result.pagination.totalItems, size: result.pagination.pageSize })}</span><Pagination className="mx-0 w-auto" aria-label={t("请求日志分页")}><PaginationContent><PaginationItem><PaginationPrevious href="#" text={t("上一页")} aria-label={t("上一页")} aria-disabled={loading || result.pagination.page === 1} className={cn((loading || result.pagination.page === 1) && "pointer-events-none opacity-50")} onClick={(event) => { event.preventDefault(); goToPage(result.pagination.page - 1) }} /></PaginationItem>{paginationTokens(result.pagination.page, result.pagination.totalPages).map((token) => typeof token === "number" ? <PaginationItem key={token}><PaginationLink href="#" isActive={token === result.pagination.page} aria-label={t("第 {{page}} 页", { page: token })} onClick={(event) => { event.preventDefault(); goToPage(token) }}>{token}</PaginationLink></PaginationItem> : <PaginationItem key={token}><PaginationEllipsis /></PaginationItem>)}<PaginationItem><PaginationNext href="#" text={t("下一页")} aria-label={t("下一页")} aria-disabled={loading || result.pagination.page === result.pagination.totalPages} className={cn((loading || result.pagination.page === result.pagination.totalPages) && "pointer-events-none opacity-50")} onClick={(event) => { event.preventDefault(); goToPage(result.pagination.page + 1) }} /></PaginationItem></PaginationContent></Pagination></CardFooter>}</Card>
      <RequestDetailSheet selected={selected} onClose={() => setSelected(null)} />
    </section>
  )
}
