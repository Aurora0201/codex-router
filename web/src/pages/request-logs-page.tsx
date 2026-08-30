import { useEffect, useMemo, useRef, useState } from "react"
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  BanIcon,
  CheckCircle2Icon,
  CircleMinusIcon,
  ClipboardIcon,
  FileClockIcon,
  Table2Icon,
  SearchIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "@/components/ui/toast"
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsPanels,
  TabsTab,
} from "@/components/animate-ui/components/base/tabs"
import { Panel } from "@/components/app/panel"
import {
  FailureBreakdownPanel,
  RequestVolumeHero,
} from "@/components/request/request-log-panels"
import { WebSocketConnectionLogsPanel } from "@/components/request/websocket-connection-logs-panel"
import { Field, FieldGroup } from "@/components/ui/field"
import { cn } from "@/lib/utils"
import type {
  AccountView,
  GatewayService,
  RequestLogFilters,
  RequestLogRange,
  RequestLogsResponse,
  RequestLogView,
  RequestOutcome,
  RequestState,
} from "@/services/contracts"

type TimelinePoint = RequestLogsResponse["timeline"][number]
type SelectedRequest = RequestLogView | TimelinePoint
type AccountOption = { value: string; label: string }

const PAGE_SIZE = 20
const RANGE_OPTIONS: Array<{ value: RequestLogRange; label: string }> = [
  { value: "1h", label: "最近 1 小时" },
  { value: "24h", label: "最近 24 小时" },
  { value: "7d", label: "最近 7 天" },
]
const toLocalDateTime = (value?: number) =>
  value
    ? new Date(value - new Date(value).getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
    : ""
const EMPTY_RESULT: RequestLogsResponse = {
  items: [],
  summary: {
    requests: 0,
    errors: 0,
    rejected: 0,
    cancelled: 0,
    availabilityRequests: 0,
    availabilityErrors: 0,
    averageDurationMs: null,
  },
  timeline: [],
  histogram: [],
  failureSources: [],
  diagnosticCodes: [],
  nextCursor: null,
  pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 0 },
}

const formatBytes = (value?: number) =>
  value == null
    ? "—"
    : value < 1024
      ? `${value} B`
      : `${(value / 1024).toFixed(1)} KB`
const isFullRequest = (value: SelectedRequest): value is RequestLogView =>
  "route" in value

const OUTCOME_LABELS: Record<RequestOutcome, string> = {
  success: "成功",
  rejected: "已拒绝",
  upstream_error: "上游故障",
  gateway_error: "网关故障",
  client_cancelled: "已取消",
}
const STATE_LABELS: Record<RequestState, string> = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  rejected: "已拒绝",
  cancelled: "已取消",
  interrupted: "进程中断",
}

function OutcomeBadge({
  outcome,
  state,
}: {
  outcome: RequestOutcome | null
  state?: RequestState
}) {
  const { t } = useTranslation()
  if (!outcome)
    return (
      <Badge variant="outline" className="text-warning">
        {t(STATE_LABELS[state ?? "running"])}
      </Badge>
    )
  const Icon =
    outcome === "success"
      ? CheckCircle2Icon
      : outcome === "client_cancelled"
        ? BanIcon
        : outcome === "rejected"
          ? CircleMinusIcon
          : TriangleAlertIcon
  return (
    <Badge
      variant="outline"
      className={cn(
        outcome === "success" && "text-success",
        outcome === "rejected" && "text-warning",
        (outcome === "upstream_error" || outcome === "gateway_error") &&
          "text-destructive",
        outcome === "client_cancelled" && "text-muted-foreground"
      )}
    >
      <Icon data-icon="inline-start" />
      {t(OUTCOME_LABELS[outcome])}
    </Badge>
  )
}

function FilterSelect({
  value,
  onChange,
  label,
  items,
  className,
}: {
  value: string
  onChange(value: string): void
  label: string
  items: { value: string; label: string }[]
  className?: string
}) {
  const selectedLabel =
    items.find((item) => item.value === value)?.label ?? items[0]?.label
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger className={cn("w-36", className)} aria-label={label}>
        <SelectValue>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

function AccountCombobox({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountView[]
  value?: string
  onChange(value?: string): void
}) {
  const { t } = useTranslation()
  const options = useMemo<AccountOption[]>(
    () => [
      { value: "all", label: t("全部账号") },
      { value: "__client_passthrough__", label: t("Codex 默认账号") },
      ...accounts.map((account) => ({
        value: account.id,
        label: account.email ?? account.chatgptAccountId ?? account.id,
      })),
    ],
    [accounts, t]
  )
  const selected =
    options.find((option) => option.value === (value ?? "all")) ?? options[0]
  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(option) =>
        onChange(option?.value === "all" ? undefined : option?.value)
      }
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
    >
      <ComboboxInput
        className="w-full"
        placeholder={t("搜索账号邮箱")}
        aria-label={t("账号筛选")}
      />
      <ComboboxContent className="min-w-80">
        <ComboboxEmpty>{t("没有匹配的账号")}</ComboboxEmpty>
        <ComboboxList>
          {(option: AccountOption) => (
            <ComboboxItem key={option.value} value={option}>
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

function RequestDataTable({
  items,
  newIds,
  page,
  onSelect,
}: {
  items: RequestLogView[]
  newIds: Set<string>
  page: number
  onSelect(item: RequestLogView): void
}) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector<HTMLElement>(
      "[data-slot=scroll-area-viewport]"
    )
    if (!viewport) return
    if (typeof viewport.scrollTo === "function") viewport.scrollTo({ top: 0 })
    else viewport.scrollTop = 0
  }, [page])
  const columns = useMemo<ColumnDef<RequestLogView>[]>(
    () => [
      {
        id: "status",
        header: t("时间与状态"),
        cell: ({ row }) => {
          const item = row.original
          return (
            <div className="flex items-center gap-2">
              <span className="w-20 tabular-nums">
                {new Date(item.startedAt).toLocaleTimeString(locale)}
              </span>
              <OutcomeBadge outcome={item.outcome} state={item.state} />
              <span className="text-muted-foreground tabular-nums">
                {item.httpStatus ??
                  (item.transport === "ws" && item.state === "completed"
                    ? 200
                    : "—")}
              </span>
            </div>
          )
        },
      },
      {
        accessorKey: "route",
        header: t("路由"),
        cell: ({ row }) => (
          <span
            className="block truncate font-mono text-xs"
            title={row.original.route}
          >
            {row.original.route}
          </span>
        ),
      },
      {
        id: "account",
        header: t("账号"),
        cell: ({ row }) => {
          const label =
            row.original.identityMode === "client_passthrough"
              ? t("Codex 默认账号")
              : (row.original.accountLabel ?? t("已删除或未路由"))
          return (
            <span className="block truncate" title={label}>
              {label}
            </span>
          )
        },
      },
      {
        accessorKey: "durationMs",
        header: t("耗时"),
        cell: ({ row }) => (
          <span className="block tabular-nums">
            {row.original.durationMs == null
              ? "—"
              : `${row.original.durationMs} ms`}
          </span>
        ),
      },
      {
        id: "traffic",
        header: t("流量"),
        cell: ({ row }) => (
          <span className="block tabular-nums">
            {formatBytes(row.original.bytesIn)} /{" "}
            {formatBytes(row.original.bytesOut)}
          </span>
        ),
      },
    ],
    [locale, t]
  )
  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <ScrollArea
      ref={scrollAreaRef}
      className="min-h-0 flex-1 [&_[data-slot=table-container]]:overflow-visible"
    >
      <Table className="min-w-[980px] table-fixed">
        <colgroup>
          <col className="w-[280px]" />
          <col className="w-[180px]" />
          <col className="w-[340px]" />
          <col className="w-[140px]" />
          <col />
        </colgroup>
        <TableHeader className="sticky top-0 z-10 [&_th]:bg-card [&_tr]:shadow-sm">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead
                  className="h-11 px-4 py-0 align-middle"
                  key={header.id}
                >
                  {flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              tabIndex={0}
              role="button"
              aria-label={t("查看请求 {{id}}", {
                id: row.original.requestId ?? row.original.id,
              })}
              onClick={() => onSelect(row.original)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ")
                  onSelect(row.original)
              }}
              className={cn(
                "h-11 cursor-pointer motion-reduce:transition-none",
                // A log is scanned for the failures, so a failed row is
                // findable without reading the outcome column.
                (row.original.outcome === "upstream_error" ||
                  row.original.outcome === "gateway_error") &&
                  "bg-destructive/5",
                newIds.has(row.original.id) &&
                  "animate-in duration-300 fade-in slide-in-from-top-1 motion-reduce:animate-none"
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell className="px-4" key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  )
}

type PaginationToken = number | "start-ellipsis" | "end-ellipsis"

function paginationTokens(page: number, totalPages: number): PaginationToken[] {
  if (totalPages <= 7)
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  if (page <= 4) return [1, 2, 3, 4, 5, "end-ellipsis", totalPages]
  if (page >= totalPages - 3)
    return [
      1,
      "start-ellipsis",
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ]
  return [
    1,
    "start-ellipsis",
    page - 1,
    page,
    page + 1,
    "end-ellipsis",
    totalPages,
  ]
}

function RequestDetailSheet({
  selected,
  onClose,
}: {
  selected: SelectedRequest | null
  onClose(): void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  if (!selected) return <Sheet open={false} />
  const full = isFullRequest(selected)
  const requestId = full ? selected.requestId : undefined
  const selectedTime = full ? selected.startedAt : selected.createdAt
  const resultLabel =
    full && selected.outcome === null
      ? t(STATE_LABELS[selected.state])
      : t(OUTCOME_LABELS[selected.outcome!])
  const groups = [
    {
      title: t("结果"),
      values: [
        [t("时间"), new Date(selectedTime).toLocaleString(locale)],
        [t("生命周期"), full ? t(STATE_LABELS[selected.state]) : "—"],
        [t("请求结果"), resultLabel],
        [t("失败来源"), full ? (selected.failureSource ?? "—") : "—"],
        [t("失败阶段"), full ? (selected.failureStage ?? "—") : "—"],
        [
          t("HTTP 状态"),
          full ? (selected.httpStatus ?? "—") : (selected.statusCode ?? "—"),
        ],
        [t("协议错误码"), full ? (selected.protocolErrorCode ?? "—") : "—"],
        [t("诊断码"), full ? (selected.diagnosticCode ?? "—") : "—"],
        [
          t("传输错误链"),
          full && selected.transportErrorChain?.length
            ? selected.transportErrorChain
                .map(({ name, code }) => [name, code].filter(Boolean).join(":"))
                .join(" → ")
            : "—",
        ],
        [t("上游请求 ID"), full ? (selected.upstreamRequestId ?? "—") : "—"],
      ],
    },
    ...(full
      ? [
          {
            title: t("路由"),
            values: [
              [t("路径"), selected.route],
              [t("传输类型"), selected.transport],
              [
                t("账号"),
                selected.identityMode === "client_passthrough"
                  ? t("Codex 默认账号")
                  : (selected.accountLabel ?? t("已删除或未路由")),
              ],
            ],
          },
        ]
      : []),
    {
      title: t("性能"),
      values: [
        [t("耗时"), `${selected.durationMs?.toLocaleString(locale) ?? "—"} ms`],
        ...(full
          ? [
              [
                t("输入 / 输出"),
                `${formatBytes(selected.bytesIn)} / ${formatBytes(selected.bytesOut)}`,
              ],
            ]
          : []),
      ],
    },
    ...(full
      ? [
          {
            title: t("请求标识"),
            values: [[t("请求 ID"), requestId ?? t("未提供")]],
          },
        ]
      : []),
  ]
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{t("请求详情")}</SheetTitle>
          <SheetDescription>
            {t("仅包含允许记录的诊断元数据。")}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 px-4 pb-4">
            {groups.map((group) => (
              <section key={group.title} className="flex flex-col gap-3">
                <h3 className="text-sm font-medium">{group.title}</h3>
                {group.values.map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="grid grid-cols-[7rem_1fr] gap-3"
                  >
                    <span className="text-sm text-muted-foreground">
                      {label}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 text-sm break-all",
                        label === t("路径") || label === t("请求 ID")
                          ? "font-mono"
                          : "tabular-nums"
                      )}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </ScrollArea>
        <SheetFooter className="border-t sm:flex-row sm:justify-end">
          {requestId && (
            <Button
              variant="outline"
              onClick={() =>
                void navigator.clipboard
                  .writeText(requestId)
                  .then(() => toast.add({ title: t("请求 ID 已复制") }))
              }
            >
              <ClipboardIcon data-icon="inline-start" />
              {t("复制请求 ID")}
            </Button>
          )}
          <SheetClose render={<Button variant="default" />}>
            {t("关闭")}
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function RequestLogsPage({
  service,
  accounts,
  enabled,
  initialErrorsOnly,
  revision,
  onShowPreferences,
}: {
  service: GatewayService
  accounts: AccountView[]
  enabled: boolean
  initialErrorsOnly: boolean
  revision: number
  onShowPreferences(): void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  const [filters, setFilters] = useState<RequestLogFilters>({
    range: "24h",
    status: initialErrorsOnly ? "error" : undefined,
    page: 1,
    limit: PAGE_SIZE,
  })
  const [queryDraft, setQueryDraft] = useState("")
  const [result, setResult] = useState(EMPTY_RESULT)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<SelectedRequest | null>(null)
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const [view, setView] = useState<"requests" | "connections">("requests")
  const knownIds = useRef(new Set<string>())
  const requestSequence = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setFilters((current) =>
          current.query === (queryDraft || undefined)
            ? current
            : {
                ...current,
                query: queryDraft || undefined,
                page: 1,
                cursor: undefined,
              }
        ),
      300
    )
    return () => window.clearTimeout(timer)
  }, [queryDraft])

  useEffect(() => {
    if (!enabled) return
    const sequence = ++requestSequence.current
    const timer = window.setTimeout(
      () => {
        setLoading(true)
        void service
          .getRequestLogs({ ...filters, cursor: undefined })
          .then((next) => {
            if (sequence !== requestSequence.current) return
            const incoming = new Set(
              next.items
                .filter((item) => !knownIds.current.has(item.id))
                .map((item) => item.id)
            )
            knownIds.current = new Set(next.items.map((item) => item.id))
            setNewIds(incoming)
            setResult(next)
            if (next.pagination.page !== filters.page) {
              setFilters((current) => ({
                ...current,
                page: next.pagination.page,
              }))
            }
            window.setTimeout(() => setNewIds(new Set()), 500)
          })
          .catch((error) =>
            toast.add({
              title: t("请求日志载入失败"),
              description: (error as Error).message,
              type: "error",
            })
          )
          .finally(
            () => sequence === requestSequence.current && setLoading(false)
          )
      },
      revision ? 150 : 0
    )
    return () => window.clearTimeout(timer)
  }, [enabled, filters, revision, service, t])

  const update = (values: Partial<RequestLogFilters>) =>
    setFilters((current) => ({
      ...current,
      ...values,
      cursor: undefined,
      page: 1,
    }))
  const goToPage = (page: number) => {
    if (
      loading ||
      page < 1 ||
      page > result.pagination.totalPages ||
      page === result.pagination.page
    )
      return
    setFilters((current) => ({ ...current, cursor: undefined, page }))
  }
  const advancedEntries = [
    // A custom window is set two ways — the date inputs and a click on the
    // histogram — and neither range tab is highlighted while one is in force,
    // so it needs a chip of its own or there is nothing to clear.
    [
      "from",
      // Not `!== undefined &&`: that yields `false`, which survives the
      // undefined filter below and would show an empty chip on every load.
      filters.from === undefined
        ? undefined
        : t("{{from}} 起", {
            from: new Date(filters.from).toLocaleString(locale),
          }),
    ],
    ["state", filters.state && t(STATE_LABELS[filters.state])],
    ["failureSource", filters.failureSource],
    ["failureStage", filters.failureStage],
    [
      "accountId",
      filters.accountId &&
        (filters.accountId === "__client_passthrough__"
          ? t("Codex 默认账号")
          : (accounts.find((account) => account.id === filters.accountId)
              ?.email ?? filters.accountId)),
    ],
    ["httpStatus", filters.httpStatus],
    ["protocolErrorCode", filters.protocolErrorCode],
    ["diagnosticCode", filters.diagnosticCode],
  ].filter((entry) => entry[1] !== undefined) as Array<
    [keyof RequestLogFilters, string | number]
  >
  const clearAdvanced = (key?: keyof RequestLogFilters) =>
    setFilters((current) => {
      const next = { ...current, page: 1, cursor: undefined }
      for (const field of key
        ? [key]
        : advancedEntries.map(([field]) => field)) {
        delete next[field]
        // The window is one filter with two fields; clearing half of it would
        // leave an open-ended range nothing displays.
        if (field === "from") delete next.to
      }
      return next
    })

  return (
    <section className="flex w-full flex-col gap-4 lg:h-full lg:min-h-0">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("请求日志")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("使用安全的结构化元数据定位失败请求，不读取请求或响应正文。")}
          </p>
        </div>
        {/* The window everything below obeys, in the page header like every
            other page's range. A custom window still lives in 更多筛选, and
            picking one there deselects these. */}
        {view === "requests" ? (
          <Tabs
            className="gap-0"
            value={filters.from !== undefined ? "custom" : filters.range}
            onValueChange={(next) => {
              if (next === "custom") return
              update({
                range: next as RequestLogRange,
                from: undefined,
                to: undefined,
              })
            }}
          >
            <TabsList aria-label={t("时间范围")}>
              {RANGE_OPTIONS.map((option) => (
                <TabsTab
                  className="text-xs"
                  key={option.value}
                  value={option.value}
                >
                  {t(option.label)}
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>
        ) : null}
      </header>
      <Tabs
        className="min-h-0 flex-1 gap-4"
        value={view}
        onValueChange={(next) => setView(next as "requests" | "connections")}
      >
        <TabsList>
          <TabsTab value="requests">{t("请求")}</TabsTab>
          <TabsTab value="connections">{t("连接诊断")}</TabsTab>
        </TabsList>
        <TabsPanels
          mode="layout"
          className="min-h-0 flex-1"
          style={{ overflow: "visible" }}
        >
          <TabsPanel
            value="connections"
            className="flex h-full min-h-0 flex-col gap-4"
          >
            <WebSocketConnectionLogsPanel
              service={service}
              revision={revision}
              accounts={accounts}
            />
          </TabsPanel>
          <TabsPanel
            value="requests"
            className="flex h-full min-h-0 flex-col gap-4"
          >
            <div className="grid shrink-0 grid-cols-12 gap-4">
              <RequestVolumeHero
                className="col-span-12 xl:col-span-8"
                summary={result.summary}
                histogram={result.histogram}
                rangeLabel={t(
                  RANGE_OPTIONS.find((option) => option.value === filters.range)
                    ?.label ?? "最近 24 小时"
                )}
                onSelectWindow={(from, to) => update({ from, to })}
              />
              <FailureBreakdownPanel
                className="col-span-12 self-start xl:col-span-4"
                summary={result.summary}
                failureSources={result.failureSources}
                diagnosticCodes={result.diagnosticCodes}
                onSelectSource={(source) => update({ failureSource: source })}
                onSelectCode={(code) => update({ diagnosticCode: code })}
              />
            </div>
            {/* The list is what the page is for, so it takes whatever height
                is left and scrolls inside its own card. */}
            <Panel
              title={t("请求记录")}
              icon={Table2Icon}
              hint={t("按时间倒序 · 共 {{total}} 条", {
                total: result.pagination.totalItems,
              })}
              className="min-h-0 flex-1"
              bodyClassName="min-h-0 flex-1 gap-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <FilterSelect
                  label={t("请求结果")}
                  value={
                    filters.status === "error"
                      ? "error"
                      : (filters.outcome ?? "all")
                  }
                  onChange={(outcome) =>
                    update(
                      outcome === "error"
                        ? { status: "error", outcome: undefined }
                        : {
                            status: undefined,
                            outcome:
                              outcome === "all"
                                ? undefined
                                : (outcome as RequestLogFilters["outcome"]),
                          }
                    )
                  }
                  items={[
                    { value: "all", label: t("全部结果") },
                    { value: "error", label: t("全部故障") },
                    ...Object.entries(OUTCOME_LABELS).map(([value, label]) => ({
                      value,
                      label: t(label),
                    })),
                  ]}
                />
                <FilterSelect
                  label={t("传输类型")}
                  className="w-40"
                  value={filters.transport ?? "all"}
                  onChange={(transport) =>
                    update({
                      transport:
                        transport === "all"
                          ? undefined
                          : (transport as RequestLogFilters["transport"]),
                    })
                  }
                  items={[
                    { value: "all", label: t("全部传输") },
                    { value: "http", label: "HTTP" },
                    { value: "ws", label: "WebSocket" },
                    { value: "compact", label: t("压缩") },
                    { value: "models", label: t("模型") },
                    { value: "search", label: t("搜索") },
                  ]}
                />
                <div className="relative min-w-64 flex-1">
                  <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    value={queryDraft}
                    onChange={(event) => setQueryDraft(event.target.value)}
                    placeholder={t("搜索路由、请求 ID、账号或错误码")}
                  />
                </div>
                <Popover>
                  <PopoverTrigger render={<Button variant="outline" />}>
                    <SlidersHorizontalIcon data-icon="inline-start" />
                    {t("更多筛选")}
                    {advancedEntries.length > 0 && (
                      <Badge variant="secondary">
                        {advancedEntries.length}
                      </Badge>
                    )}
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-[min(34rem,calc(100vw-2rem))]"
                  >
                    <PopoverHeader>
                      <PopoverTitle>{t("更多筛选")}</PopoverTitle>
                      <PopoverDescription>
                        {t("摘要和请求列表使用相同筛选范围。")}
                      </PopoverDescription>
                    </PopoverHeader>
                    {filters.from !== undefined && (
                      <FieldGroup className="grid gap-3 sm:grid-cols-2">
                        <Field>
                          <Input
                            aria-label={t("开始时间")}
                            type="datetime-local"
                            className="w-full"
                            value={toLocalDateTime(filters.from)}
                            onChange={(event) =>
                              event.target.value &&
                              update({
                                from: new Date(event.target.value).getTime(),
                              })
                            }
                          />
                        </Field>
                        <Field>
                          <Input
                            aria-label={t("结束时间")}
                            type="datetime-local"
                            className="w-full"
                            value={toLocalDateTime(filters.to)}
                            onChange={(event) =>
                              event.target.value &&
                              update({
                                to: new Date(event.target.value).getTime(),
                              })
                            }
                          />
                        </Field>
                      </FieldGroup>
                    )}
                    <FieldGroup className="grid gap-3 sm:grid-cols-2">
                      <Field>
                        <FilterSelect
                          className="w-full"
                          label={t("生命周期")}
                          value={filters.state ?? "all"}
                          onChange={(value) =>
                            update({
                              state:
                                value === "all"
                                  ? undefined
                                  : (value as RequestLogFilters["state"]),
                            })
                          }
                          items={[
                            { value: "all", label: t("全部生命周期") },
                            ...Object.entries(STATE_LABELS).map(
                              ([value, label]) => ({
                                value,
                                label: t(label),
                              })
                            ),
                          ]}
                        />
                      </Field>
                      <Field>
                        <AccountCombobox
                          accounts={accounts}
                          value={filters.accountId}
                          onChange={(accountId) => update({ accountId })}
                        />
                      </Field>
                      <Field>
                        <FilterSelect
                          className="w-full"
                          label={t("失败来源")}
                          value={filters.failureSource ?? "all"}
                          onChange={(value) =>
                            update({
                              failureSource:
                                value === "all"
                                  ? undefined
                                  : (value as RequestLogFilters["failureSource"]),
                            })
                          }
                          items={[
                            { value: "all", label: t("全部来源") },
                            ...(
                              [
                                "gateway",
                                "upstream_http",
                                "upstream_protocol",
                                "transport",
                                "client",
                              ] as const
                            ).map((value) => ({ value, label: value })),
                          ]}
                        />
                      </Field>
                      <Field>
                        <FilterSelect
                          className="w-full"
                          label={t("失败阶段")}
                          value={filters.failureStage ?? "all"}
                          onChange={(value) =>
                            update({
                              failureStage:
                                value === "all"
                                  ? undefined
                                  : (value as RequestLogFilters["failureStage"]),
                            })
                          }
                          items={[
                            { value: "all", label: t("全部阶段") },
                            ...(
                              [
                                "routing",
                                "authentication",
                                "handshake",
                                "sending",
                                "streaming",
                                "terminal",
                              ] as const
                            ).map((value) => ({ value, label: value })),
                          ]}
                        />
                      </Field>
                      <Field>
                        <Input
                          aria-label={t("HTTP 状态")}
                          className="w-full"
                          inputMode="numeric"
                          placeholder={t("HTTP 状态")}
                          value={filters.httpStatus ?? ""}
                          onChange={(event) =>
                            update({
                              httpStatus: event.target.value
                                ? Number(event.target.value)
                                : undefined,
                            })
                          }
                        />
                      </Field>
                      <Field>
                        <Input
                          aria-label={t("协议错误码")}
                          className="w-full"
                          placeholder={t("协议错误码")}
                          value={filters.protocolErrorCode ?? ""}
                          onChange={(event) =>
                            update({
                              protocolErrorCode:
                                event.target.value || undefined,
                            })
                          }
                        />
                      </Field>
                      <Field>
                        <Input
                          aria-label={t("诊断码")}
                          className="w-full"
                          placeholder={t("诊断码")}
                          value={filters.diagnosticCode ?? ""}
                          onChange={(event) =>
                            update({
                              diagnosticCode: event.target.value || undefined,
                            })
                          }
                        />
                      </Field>
                    </FieldGroup>
                    {advancedEntries.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        {advancedEntries.map(([key, label]) => (
                          <Badge key={key} variant="secondary">
                            {String(label)}
                            <button
                              type="button"
                              aria-label={t("移除筛选 {{filter}}", {
                                filter: String(label),
                              })}
                              onClick={() => clearAdvanced(key)}
                            >
                              <XIcon />
                            </button>
                          </Badge>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => clearAdvanced()}
                        >
                          {t("清除全部")}
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-card">
                {!enabled || (!loading && result.items.length === 0) ? (
                  <Empty className="h-full min-h-80 border-0 lg:min-h-0">
                    <EmptyHeader>
                      <EmptyMedia variant="icon">
                        <FileClockIcon />
                      </EmptyMedia>
                      <EmptyTitle>
                        {enabled
                          ? t("没有匹配的请求记录")
                          : t("请求元数据记录已关闭")}
                      </EmptyTitle>
                      <EmptyDescription>
                        {enabled
                          ? t("调整筛选条件后重试。")
                          : t("启用后只记录状态、耗时和路由等安全元数据。")}
                      </EmptyDescription>
                    </EmptyHeader>
                    {!enabled && (
                      <EmptyContent>
                        <Button variant="outline" onClick={onShowPreferences}>
                          {t("前往偏好设置")}
                        </Button>
                      </EmptyContent>
                    )}
                  </Empty>
                ) : (
                  <RequestDataTable
                    items={result.items}
                    newIds={newIds}
                    page={result.pagination.page}
                    onSelect={setSelected}
                  />
                )}
                {result.pagination.totalPages > 0 && (
                  <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2.5">
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {t("共 {{total}} 条 · 每页 {{size}} 条", {
                        total: result.pagination.totalItems,
                        size: result.pagination.pageSize,
                      })}
                    </span>
                    <Pagination
                      className="mx-0 w-auto"
                      aria-label={t("请求日志分页")}
                    >
                      <PaginationContent>
                        <PaginationItem>
                          <PaginationPrevious
                            href="#"
                            text={t("上一页")}
                            aria-label={t("上一页")}
                            aria-disabled={
                              loading || result.pagination.page === 1
                            }
                            className={cn(
                              (loading || result.pagination.page === 1) &&
                                "pointer-events-none opacity-50"
                            )}
                            onClick={(event) => {
                              event.preventDefault()
                              goToPage(result.pagination.page - 1)
                            }}
                          />
                        </PaginationItem>
                        {paginationTokens(
                          result.pagination.page,
                          result.pagination.totalPages
                        ).map((token) =>
                          typeof token === "number" ? (
                            <PaginationItem key={token}>
                              <PaginationLink
                                href="#"
                                isActive={token === result.pagination.page}
                                aria-label={t("第 {{page}} 页", {
                                  page: token,
                                })}
                                onClick={(event) => {
                                  event.preventDefault()
                                  goToPage(token)
                                }}
                              >
                                {token}
                              </PaginationLink>
                            </PaginationItem>
                          ) : (
                            <PaginationItem key={token}>
                              <PaginationEllipsis />
                            </PaginationItem>
                          )
                        )}
                        <PaginationItem>
                          <PaginationNext
                            href="#"
                            text={t("下一页")}
                            aria-label={t("下一页")}
                            aria-disabled={
                              loading ||
                              result.pagination.page ===
                                result.pagination.totalPages
                            }
                            className={cn(
                              (loading ||
                                result.pagination.page ===
                                  result.pagination.totalPages) &&
                                "pointer-events-none opacity-50"
                            )}
                            onClick={(event) => {
                              event.preventDefault()
                              goToPage(result.pagination.page + 1)
                            }}
                          />
                        </PaginationItem>
                      </PaginationContent>
                    </Pagination>
                  </div>
                )}
              </div>
            </Panel>
            <RequestDetailSheet
              selected={selected}
              onClose={() => setSelected(null)}
            />
          </TabsPanel>
        </TabsPanels>
      </Tabs>
    </section>
  )
}
