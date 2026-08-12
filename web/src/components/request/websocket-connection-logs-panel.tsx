import { useEffect, useRef, useState } from "react"
import { ChevronDownIcon, RadioIcon, SearchIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
  SheetContent,
  SheetDescription,
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
import { cn } from "@/lib/utils"
import type {
  AccountView,
  GatewayService,
  WebSocketConnectionLogFilters,
  WebSocketConnectionLogsResponse,
  WebSocketConnectionLogView,
} from "@/services/contracts"

const PAGE_SIZE = 20
const EMPTY: WebSocketConnectionLogsResponse = {
  items: [],
  summary: { connections: 0, failures: 0, retired: 0 },
  nextCursor: null,
  pagination: { page: 1, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 0 },
}
const LABELS: Record<WebSocketConnectionLogView["outcome"], string> = {
  connected: "已连接",
  rejected: "握手拒绝",
  failed: "连接失败",
  retired: "正常退役",
  closed: "已关闭",
}
const value = (input: unknown) =>
  input === undefined || input === null ? "—" : String(input)
const local = (time?: number) =>
  time
    ? new Date(time - new Date(time).getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
    : ""
type Token = number | "start" | "end"
const tokens = (page: number, total: number): Token[] =>
  total <= 7
    ? Array.from({ length: total }, (_, index) => index + 1)
    : page <= 4
      ? [1, 2, 3, 4, 5, "end", total]
      : page >= total - 3
        ? [1, "start", total - 4, total - 3, total - 2, total - 1, total]
        : [1, "start", page - 1, page, page + 1, "end", total]

function Choice({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: string
  items: Array<{ value: string; label: string }>
  onChange(value: string): void
}) {
  return (
    <Select value={value} onValueChange={(next) => next && onChange(next)}>
      <SelectTrigger className="w-40" aria-label={label}>
        <SelectValue>
          {items.find((item) => item.value === value)?.label}
        </SelectValue>
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

function AccountFilter({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountView[]
  value?: string
  onChange(value?: string): void
}) {
  const options = [
    { value: "all", label: "全部账号" },
    { value: "__client_passthrough__", label: "Codex 默认账号" },
    ...accounts.map((account) => ({
      value: account.id,
      label: account.email ?? account.chatgptAccountId ?? account.id,
    })),
  ]
  const selected =
    options.find((item) => item.value === (value ?? "all")) ?? options[0]
  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(item) =>
        onChange(item?.value === "all" ? undefined : item?.value)
      }
      itemToStringLabel={(item) => item.label}
      itemToStringValue={(item) => item.value}
    >
      <ComboboxInput className="w-56" aria-label="账号筛选" />
      <ComboboxContent>
        <ComboboxEmpty>没有匹配的账号</ComboboxEmpty>
        <ComboboxList>
          {(item: { value: string; label: string }) => (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export function WebSocketConnectionLogsPanel({
  service,
  revision,
  accounts,
}: {
  service: GatewayService
  revision: number
  accounts: AccountView[]
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  const [filters, setFilters] = useState<WebSocketConnectionLogFilters>({
    range: "24h",
    page: 1,
    limit: PAGE_SIZE,
  })
  const [query, setQuery] = useState("")
  const [advanced, setAdvanced] = useState(false)
  const [result, setResult] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selected, setSelected] = useState<WebSocketConnectionLogView | null>(
    null
  )
  const sequence = useRef(0)
  const scroll = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setFilters((current) =>
          current.query === (query || undefined)
            ? current
            : { ...current, query: query || undefined, page: 1 }
        ),
      300
    )
    return () => window.clearTimeout(timer)
  }, [query])
  useEffect(() => {
    const current = ++sequence.current
    // Query-key changes intentionally reset the visible async state before fetching.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(false)
    void service
      .getWebSocketConnectionLogs(filters)
      .then((next) => {
        if (current !== sequence.current) return
        setResult(next)
        if (next.pagination.page !== filters.page)
          setFilters((value) => ({ ...value, page: next.pagination.page }))
      })
      .catch(() => {
        if (current === sequence.current) {
          setError(true)
          toast.add({ title: t("连接诊断载入失败"), type: "error" })
        }
      })
      .finally(() => current === sequence.current && setLoading(false))
  }, [filters, revision, service, t])
  useEffect(() => {
    const viewport = scroll.current?.querySelector<HTMLElement>(
      "[data-slot=scroll-area-viewport]"
    )
    if (!viewport) return
    if (typeof viewport.scrollTo === "function") viewport.scrollTo({ top: 0 })
    else viewport.scrollTop = 0
  }, [result.pagination.page])
  const update = (next: Partial<WebSocketConnectionLogFilters>) =>
    setFilters((current) => ({
      ...current,
      ...next,
      page: 1,
      cursor: undefined,
    }))
  const page = (next: number) => {
    if (!loading && next >= 1 && next <= result.pagination.totalPages)
      setFilters((current) => ({ ...current, page: next, cursor: undefined }))
  }
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("筛选连接")}</CardTitle>
          <CardDescription>
            {t("摘要和连接列表使用相同筛选范围。")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Choice
            label={t("时间范围")}
            value={filters.from !== undefined ? "custom" : filters.range}
            onChange={(range) =>
              update(
                range === "custom"
                  ? { from: Date.now() - 3_600_000, to: Date.now() }
                  : {
                      range: range as WebSocketConnectionLogFilters["range"],
                      from: undefined,
                      to: undefined,
                    }
              )
            }
            items={[
              { value: "1h", label: t("最近 1 小时") },
              { value: "24h", label: t("最近 24 小时") },
              { value: "7d", label: t("最近 7 天") },
              { value: "custom", label: t("自定义时间") },
            ]}
          />
          <Choice
            label={t("连接结果")}
            value={filters.outcome ?? "all"}
            onChange={(outcome) =>
              update({
                outcome:
                  outcome === "all"
                    ? undefined
                    : (outcome as WebSocketConnectionLogFilters["outcome"]),
              })
            }
            items={[
              { value: "all", label: t("全部结果") },
              ...Object.entries(LABELS).map(([value, label]) => ({
                value,
                label: t(label),
              })),
            ]}
          />
          <div className="relative min-w-64 flex-1">
            <SearchIcon className="pointer-events-none absolute top-2 left-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-8"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("搜索连接 ID、关闭原因或账号")}
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setAdvanced((value) => !value)}
            aria-expanded={advanced}
          >
            {t("更多筛选")}
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
          {filters.from !== undefined && (
            <div className="flex basis-full flex-wrap items-center gap-2">
              <Input
                type="datetime-local"
                aria-label={t("开始时间")}
                className="w-auto"
                value={local(filters.from)}
                onChange={(event) =>
                  event.target.value &&
                  update({ from: new Date(event.target.value).getTime() })
                }
              />
              <span className="text-muted-foreground">—</span>
              <Input
                type="datetime-local"
                aria-label={t("结束时间")}
                className="w-auto"
                value={local(filters.to)}
                onChange={(event) =>
                  event.target.value &&
                  update({ to: new Date(event.target.value).getTime() })
                }
              />
            </div>
          )}
          {advanced && (
            <div className="flex basis-full flex-wrap items-center gap-2 border-t pt-3">
              <AccountFilter
                accounts={accounts}
                value={filters.accountId}
                onChange={(accountId) => update({ accountId })}
              />
              <Choice
                label={t("关闭发起方")}
                value={filters.closeInitiator ?? "all"}
                onChange={(closeInitiator) =>
                  update({
                    closeInitiator:
                      closeInitiator === "all"
                        ? undefined
                        : (closeInitiator as WebSocketConnectionLogFilters["closeInitiator"]),
                  })
                }
                items={[
                  { value: "all", label: t("全部发起方") },
                  { value: "client", label: "client" },
                  { value: "upstream", label: "upstream" },
                  { value: "gateway", label: "gateway" },
                ]}
              />
              {[
                ["handshakeHttpStatus", "握手 HTTP"],
                ["clientCloseCode", "客户端关闭码"],
                ["upstreamCloseCode", "上游关闭码"],
              ].map(([key, label]) => (
                <Input
                  key={key}
                  aria-label={t(label)}
                  className="w-36"
                  inputMode="numeric"
                  placeholder={t(label)}
                  value={
                    (filters[
                      key as keyof WebSocketConnectionLogFilters
                    ] as number) ?? ""
                  }
                  onChange={(event) =>
                    update({
                      [key]: event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    })
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          [t("连接总数"), result.summary.connections],
          [t("失败 / 拒绝"), result.summary.failures],
          [t("正常退役"), result.summary.retired],
        ].map(([label, count], index) => (
          <Card key={String(label)} size="sm">
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle
                className={cn(
                  "text-2xl tabular-nums",
                  index === 1 && Number(count) > 0 && "text-destructive"
                )}
              >
                {Number(count).toLocaleString(locale)}
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card className="min-h-0 gap-0 overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle>{t("WebSocket 连接诊断")}</CardTitle>
          <CardDescription>
            {t("握手与关闭证据独立于请求结果，不参与请求成功率。")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <Empty className="min-h-80 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RadioIcon />
                </EmptyMedia>
                <EmptyTitle>{t("连接诊断载入失败")}</EmptyTitle>
                <EmptyDescription>
                  {t("请稍后重试或调整筛选条件。")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : !loading && result.items.length === 0 ? (
            <Empty className="min-h-80 border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <RadioIcon />
                </EmptyMedia>
                <EmptyTitle>{t("没有匹配的连接诊断")}</EmptyTitle>
                <EmptyDescription>{t("调整筛选条件后重试。")}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ScrollArea
              ref={scroll}
              className="h-[31rem] [&_[data-slot=table-container]]:overflow-visible"
            >
              <Table className="min-w-[760px] table-fixed">
                <TableHeader className="sticky top-0 z-10 [&_th]:bg-card [&_tr]:shadow-sm">
                  <TableRow>
                    <TableHead className="w-56 pl-4">
                      {t("时间与结果")}
                    </TableHead>
                    <TableHead>{t("连接")}</TableHead>
                    <TableHead className="w-28">{t("握手 HTTP")}</TableHead>
                    <TableHead className="w-32">{t("关闭码")}</TableHead>
                    <TableHead className="w-56">{t("关闭原因")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((item) => (
                    <TableRow
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      className="h-11 cursor-pointer"
                      onClick={() => setSelected(item)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ")
                          setSelected(item)
                      }}
                    >
                      <TableCell className="pl-4">
                        <span className="inline-flex items-center gap-2">
                          <span className="tabular-nums">
                            {new Date(item.startedAt).toLocaleTimeString(
                              locale
                            )}
                          </span>
                          <span>{t(LABELS[item.outcome])}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className="block truncate"
                          title={item.connectionId}
                        >
                          {item.connectionId}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {value(item.handshakeHttpStatus)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        <span
                          title={`${t("客户端")}: ${value(item.clientCloseCode)} · ${t("上游")}: ${value(item.upstreamCloseCode)}`}
                        >
                          {item.clientCloseCode !== undefined
                            ? `C ${item.clientCloseCode}`
                            : item.upstreamCloseCode !== undefined
                              ? `U ${item.upstreamCloseCode}`
                              : "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className="block truncate"
                          title={item.closeReasonCode}
                        >
                          {value(item.closeReasonCode)}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>
          )}
        </CardContent>
        {result.pagination.totalPages > 0 && (
          <CardFooter className="justify-between py-3">
            <span className="text-sm text-muted-foreground tabular-nums">
              {t("共 {{total}} 条 · 每页 {{size}} 条", {
                total: result.pagination.totalItems,
                size: result.pagination.pageSize,
              })}
            </span>
            <Pagination className="mx-0 w-auto" aria-label={t("连接诊断分页")}>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    href="#"
                    text={t("上一页")}
                    aria-disabled={loading || result.pagination.page === 1}
                    className={cn(
                      (loading || result.pagination.page === 1) &&
                        "pointer-events-none opacity-50"
                    )}
                    onClick={(event) => {
                      event.preventDefault()
                      page(result.pagination.page - 1)
                    }}
                  />
                </PaginationItem>
                {tokens(
                  result.pagination.page,
                  result.pagination.totalPages
                ).map((token) =>
                  typeof token === "number" ? (
                    <PaginationItem key={token}>
                      <PaginationLink
                        href="#"
                        isActive={token === result.pagination.page}
                        aria-label={t("第 {{page}} 页", { page: token })}
                        onClick={(event) => {
                          event.preventDefault()
                          page(token)
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
                    aria-disabled={
                      loading ||
                      result.pagination.page === result.pagination.totalPages
                    }
                    className={cn(
                      (loading ||
                        result.pagination.page ===
                          result.pagination.totalPages) &&
                        "pointer-events-none opacity-50"
                    )}
                    onClick={(event) => {
                      event.preventDefault()
                      page(result.pagination.page + 1)
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </CardFooter>
        )}
      </Card>
      {selected ? (
        <Sheet open onOpenChange={(open) => !open && setSelected(null)}>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>{t("连接诊断详情")}</SheetTitle>
              <SheetDescription>
                {t("仅包含握手和关闭元数据。")}
              </SheetDescription>
            </SheetHeader>
            <div className="grid grid-cols-[8rem_1fr] gap-3 px-4 text-sm">
              {[
                [t("连接 ID"), selected.connectionId],
                [t("结果"), t(LABELS[selected.outcome])],
                [t("握手 HTTP"), value(selected.handshakeHttpStatus)],
                [t("客户端关闭码"), value(selected.clientCloseCode)],
                [t("上游关闭码"), value(selected.upstreamCloseCode)],
                [t("关闭发起方"), value(selected.closeInitiator)],
                [t("关闭原因"), value(selected.closeReasonCode)],
              ].map(([label, entry]) => (
                <div className="contents" key={String(label)}>
                  <span className="text-muted-foreground">{label}</span>
                  <span className="break-all">{entry}</span>
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  )
}
