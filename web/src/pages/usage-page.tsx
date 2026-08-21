import { useEffect, useMemo, useState } from "react"
import { AlertTriangleIcon, DatabaseIcon, InfoIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { CodexUsageDashboard, CodexUsageRange, GatewayService } from "@/services/contracts"

const trendConfig = {
  cachedInputTokens: { label: "缓存输入", color: "var(--chart-1)" },
  uncachedInputTokens: { label: "非缓存输入", color: "var(--chart-2)" },
  outputTokens: { label: "输出", color: "var(--chart-3)" },
  rollingAverage7d: { label: "7 日均线", color: "var(--chart-5)" },
} satisfies ChartConfig
const rankingConfig = { totalTokens: { label: "Token", color: "var(--chart-2)" } } satisfies ChartConfig
const modelColors = Array.from({ length: 8 }, (_, index) => `var(--chart-${index + 1})`)
const ranges: Array<{ value: CodexUsageRange; label: string }> = [
  { value: "7d", label: "最近 7 天" }, { value: "14d", label: "最近 14 天" }, { value: "30d", label: "最近 30 天" },
  { value: "90d", label: "最近 90 天" }, { value: "all", label: "全部历史" },
]
const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const weekdayLabels: Record<string, string> = { Mon: "一", Tue: "二", Wed: "三", Thu: "四", Fri: "五", Sat: "六", Sun: "日" }

function formatTokens(value: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: value >= 1_000_000 ? 1 : 0 }).format(value)
}
function fullTokens(value: number): string { return new Intl.NumberFormat().format(value) }
function formatDate(value: number | null): string { return value ? new Date(value).toLocaleString() : "—" }
function formatDay(value: number): string { return new Date(value).toLocaleDateString() }
function isProjectIdentifier(key: string): boolean { return key !== "uncategorized-conversation" && key !== "other" }

function LoadingDashboard() {
  return <div className="grid grid-cols-1 gap-4 lg:grid-cols-12" aria-label="正在扫描本机 Codex 用量">
    {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-28 lg:col-span-3" />)}
    <Skeleton className="h-96 lg:col-span-8" /><Skeleton className="h-96 lg:col-span-4" />
  </div>
}

function MetricCard({ label, value, description }: { label: string; value: string; description: string }) {
  return <Card className="lg:col-span-3"><CardHeader><CardDescription>{label}</CardDescription><CardTitle className="font-mono text-2xl tabular-nums">{value}</CardTitle></CardHeader><CardContent className="text-xs text-muted-foreground">{description}</CardContent></Card>
}

function ModelRankingCard({ title, description, data }: { title: string; description: string; data: CodexUsageDashboard["models"] }) {
  return <Card className="min-h-0 lg:col-span-6 lg:h-full"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="min-h-0 lg:flex-1">
    {data.length ? <ScrollArea className="lg:h-full" aria-label={`${title}滚动区域`}>
      <ChartContainer config={rankingConfig} className="h-64 min-h-full w-full pr-3 font-mono" style={{ height: Math.max(256, data.length * 44) }} aria-label={title}>
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 8, right: 32 }}>
        <CartesianGrid horizontal={false} /><YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={144} tick={{ className: "font-mono" }} tickFormatter={(value) => String(value).slice(0, 18)} />
        <XAxis type="number" hide /><ChartTooltip content={<ChartTooltipContent formatter={(value) => <span className="font-mono tabular-nums">{fullTokens(Number(value))}</span>} />} />
        <Bar dataKey="totalTokens" fill="var(--color-totalTokens)" radius={4} />
      </BarChart>
      </ChartContainer>
    </ScrollArea> : <Empty className="h-64 lg:h-full"><EmptyHeader><EmptyTitle>暂无分布数据</EmptyTitle><EmptyDescription>当前筛选范围内没有可比较的数据。</EmptyDescription></EmptyHeader></Empty>}
  </CardContent></Card>
}

function ProjectRankingCard({ data }: { data: CodexUsageDashboard["projects"] }) {
  const { t } = useTranslation()
  return <Card className="min-h-0 lg:col-span-6 lg:h-full"><CardHeader><CardTitle>{t("项目分布")}</CardTitle><CardDescription>{t("无分类对话单独汇总；长项目名可悬停或聚焦查看完整内容。")}</CardDescription></CardHeader><CardContent className="min-h-0 lg:flex-1">
    {data.length ? <ScrollArea className="lg:h-full" aria-label={t("项目分布滚动区域") as string}><div className="flex min-h-64 flex-col gap-4 pr-3 lg:min-h-0" aria-label={t("项目分布排名") as string}>
      {data.map((item, index) => <div key={item.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 gap-y-2">
        <span className="row-span-2 pt-0.5 font-mono text-xs text-muted-foreground tabular-nums">{index + 1}</span>
        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <Tooltip><TooltipTrigger render={<span tabIndex={0} className={cn("min-w-0 truncate text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", isProjectIdentifier(item.key) && "font-mono")} />}>{item.label}</TooltipTrigger><TooltipContent className={cn(isProjectIdentifier(item.key) && "font-mono")}>{item.label}</TooltipContent></Tooltip>
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">{formatTokens(item.totalTokens)} · {(item.share * 100).toFixed(1)}%</span>
        </div>
        <Progress value={item.share * 100} aria-label={t("{{project}} Token 占比 {{percent}}", { project: item.label, percent: `${(item.share * 100).toFixed(1)}%` })} />
      </div>)}
    </div></ScrollArea> : <Empty className="h-64 lg:h-full"><EmptyHeader><EmptyTitle>{t("暂无分布数据")}</EmptyTitle><EmptyDescription>{t("当前筛选范围内没有可比较的数据。")}</EmptyDescription></EmptyHeader></Empty>}
  </CardContent></Card>
}

export function UsagePage({ service, revision = 0 }: { service: GatewayService; revision?: number }) {
  const { t } = useTranslation()
  const [range, setRange] = useState<CodexUsageRange>("14d")
  const [model, setModel] = useState("all")
  const [project, setProject] = useState("all")
  const [data, setData] = useState<CodexUsageDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [request, setRequest] = useState(0)

  useEffect(() => {
    let cancelled = false
    void service.getCodexUsage({ range, model: model === "all" ? undefined : model, project: project === "all" ? undefined : project })
      .then((next) => { if (!cancelled) { setData(next); setError(null) } })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message) })
    return () => { cancelled = true }
  }, [service, range, model, project, revision, request])

  const heat = useMemo(() => new Map(data?.heatmap.map((item) => [`${item.weekday}|${item.hour}`, item.totalTokens]) ?? []), [data])
  const heatMax = Math.max(0, ...heat.values())
  const modelTrend = useMemo(() => {
    const series = data?.models.filter((model) => model.totalTokens > 0).map((model, index) => ({ ...model, dataKey: `model${index}`, color: modelColors[index % modelColors.length] })) ?? []
    const indexByKey = new Map(series.map((model) => [model.key, model.dataKey]))
    const rows = data?.dailyModels.map((day) => {
      const row: Record<string, string | number | boolean> = { date: day.date, totalTokens: day.totalTokens, isPartial: day.isPartial }
      for (const model of day.models) { const key = indexByKey.get(model.key); if (key) row[key] = model.totalTokens }
      return row
    }) ?? []
    const config = Object.fromEntries(series.map((model) => [model.dataKey, { label: <span className="font-mono">{model.label}</span>, color: model.color }])) satisfies ChartConfig
    return { series, rows, config }
  }, [data])
  const selectedProject = project === "all" ? null : data?.filters.projects.find((item) => item.key === project)
  const selectedProjectLabel = selectedProject?.label ?? t("全部项目")
  if (!data && !error) return <div className="flex flex-col gap-4"><PageIntro /><LoadingDashboard /></div>

  return <div className="flex flex-col gap-4">
    <PageIntro />
    <div className="flex flex-wrap items-center gap-2" aria-label={t("用量筛选") as string}>
      <Select value={range} onValueChange={(value) => value && setRange(value as CodexUsageRange)}><SelectTrigger className="w-36" aria-label={t("时间范围")}><SelectValue>{t(ranges.find((item) => item.value === range)?.label ?? "最近 14 天")}</SelectValue></SelectTrigger><SelectContent><SelectGroup>{ranges.map((item) => <SelectItem key={item.value} value={item.value}>{t(item.label)}</SelectItem>)}</SelectGroup></SelectContent></Select>
      <Select value={model} onValueChange={(value) => value && setModel(value)}><SelectTrigger className="w-44" aria-label={t("模型筛选")}><SelectValue className={cn(model !== "all" && "font-mono")}>{model === "all" ? t("全部模型") : model}</SelectValue></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">{t("全部模型")}</SelectItem>{data?.filters.models.map((item) => <SelectItem className="font-mono" key={item} value={item}>{item}</SelectItem>)}</SelectGroup></SelectContent></Select>
      <Select value={project} onValueChange={(value) => value && setProject(value)}>
        <Tooltip>
          <TooltipTrigger render={<span className="block w-full min-w-0 sm:w-64 lg:w-72" />}>
            <SelectTrigger className="w-full min-w-0 overflow-hidden" aria-label={t("项目筛选")}>
              <SelectValue className={cn("min-w-0 overflow-hidden", selectedProject && isProjectIdentifier(selectedProject.key) && "font-mono")}>
                <span className="min-w-0 flex-1 truncate">{selectedProjectLabel}</span>
              </SelectValue>
            </SelectTrigger>
          </TooltipTrigger>
          <TooltipContent className={cn("max-w-sm break-all", selectedProject && isProjectIdentifier(selectedProject.key) && "font-mono")}>{selectedProjectLabel}</TooltipContent>
        </Tooltip>
        <SelectContent alignItemWithTrigger={false} className="w-[min(24rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)]">
          <SelectGroup>
            <SelectItem value="all">{t("全部项目")}</SelectItem>
            {data?.filters.projects.map((item) => <SelectItem aria-label={item.label} title={item.label} className={cn("min-w-0 max-w-full overflow-hidden [&>span:first-child]:min-w-0 [&>span:first-child]:shrink [&>span:first-child]:overflow-hidden", isProjectIdentifier(item.key) && "font-mono")} key={item.key} value={item.key}><span className="min-w-0 flex-1 truncate text-left">{item.label}</span></SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      {data?.status === "scanning" ? <Badge variant="secondary">{t("正在更新")}</Badge> : null}
      {data?.status === "partial" ? <Badge variant="outline">{t("部分数据")}</Badge> : null}
      {data?.coverage.firstEventAt ? <span className="text-xs text-muted-foreground">{t("本机数据始于 {{date}}；更早的本地记录不可恢复。", { date: formatDay(data.coverage.firstEventAt) })}</span> : null}
    </div>
    {error ? <Alert variant="destructive"><AlertTriangleIcon /><AlertTitle>{t("用量数据载入失败")}</AlertTitle><AlertDescription className="flex items-center gap-3"><span>{error}</span><Button variant="outline" size="sm" onClick={() => setRequest((value) => value + 1)}>{t("重试")}</Button></AlertDescription></Alert> : null}
    {data && data.coverage.rollouts === 0 && data.status !== "scanning" ? <Empty className="min-h-80 border"><EmptyMedia variant="icon"><DatabaseIcon /></EmptyMedia><EmptyHeader><EmptyTitle>{t("没有本地用量数据")}</EmptyTitle><EmptyDescription>{t("Codex 创建会话记录后，用量趋势会自动出现在这里。")}</EmptyDescription></EmptyHeader></Empty> : null}
    {data && data.coverage.rollouts > 0 ? <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <MetricCard label={t("区间总 Token")} value={formatTokens(data.summary.totalTokens)} description={t("输入与输出之和，不重复计算缓存和推理子集。") as string} />
      <MetricCard label={t("今日 Token")} value={formatTokens(data.summary.todayTokens)} description={t("今天仍在进行中，数值会持续更新。") as string} />
      <MetricCard label={t("日均 Token")} value={formatTokens(data.summary.dailyAverage)} description={t("按所选自然日计算，包含零用量日期。") as string} />
      <MetricCard label={t("缓存命中率")} value={`${data.summary.cacheHitPercent.toFixed(1)}%`} description={t("缓存输入占全部输入 Token 的比例。") as string} />

      <div className="grid grid-cols-1 gap-4 lg:col-span-12 lg:h-[28rem] lg:grid-cols-12">
      <Card className="min-h-0 lg:col-span-8 lg:h-full"><CardHeader><CardTitle>{t("每日 Token 趋势")}</CardTitle><CardDescription>{t("堆叠序列可以相加；7 日均线用于观察变化方向。")}</CardDescription></CardHeader><CardContent className="min-h-0 lg:flex-1">
        <ChartContainer config={trendConfig} className="h-80 w-full lg:h-full" aria-label={t("每日 Token 趋势") as string}>
          <ComposedChart accessibilityLayer data={data.daily} margin={{ left: 4, right: 8 }}><CartesianGrid vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} tick={{ className: "font-mono tabular-nums" }} tickFormatter={(value) => String(value).slice(5)} /><YAxis tickLine={false} axisLine={false} width={48} tick={{ className: "font-mono tabular-nums" }} tickFormatter={formatTokens} />
            <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => <div className="flex min-w-36 justify-between gap-3"><span className="text-muted-foreground">{trendConfig[name as keyof typeof trendConfig]?.label}</span><span className="font-mono tabular-nums">{fullTokens(Number(value))}</span></div>} />} />
            <ChartLegend content={<ChartLegendContent />} /><Bar dataKey="cachedInputTokens" stackId="tokens" fill="var(--color-cachedInputTokens)" /><Bar dataKey="uncachedInputTokens" stackId="tokens" fill="var(--color-uncachedInputTokens)" /><Bar dataKey="outputTokens" stackId="tokens" fill="var(--color-outputTokens)" radius={[3, 3, 0, 0]} /><Line dataKey="rollingAverage7d" type="monotone" stroke="var(--color-rollingAverage7d)" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ChartContainer>
      </CardContent></Card>

      <Card className="min-h-0 lg:col-span-4 lg:h-full"><CardHeader><CardTitle>{t("用量结构")}</CardTitle><CardDescription>{t("缓存属于输入，推理属于输出，均不额外计入总量。")}</CardDescription></CardHeader><CardContent className="flex flex-col gap-5 lg:min-h-0 lg:flex-1 lg:justify-evenly">
        {[{ label: t("输入 Token"), value: data.summary.inputTokens, percent: data.summary.totalTokens ? data.summary.inputTokens / data.summary.totalTokens * 100 : 0 }, { label: t("输出 Token"), value: data.summary.outputTokens, percent: data.summary.totalTokens ? data.summary.outputTokens / data.summary.totalTokens * 100 : 0 }, { label: t("缓存输入"), value: data.summary.cachedInputTokens, percent: data.summary.cacheHitPercent }, { label: t("推理输出"), value: data.summary.reasoningOutputTokens, percent: data.summary.outputTokens ? data.summary.reasoningOutputTokens / data.summary.outputTokens * 100 : 0 }].map((item) => <Progress key={item.label} value={item.percent}><ProgressLabel>{item.label}</ProgressLabel><ProgressValue className="font-mono">{() => `${formatTokens(item.value)} · ${item.percent.toFixed(1)}%`}</ProgressValue></Progress>)}
      </CardContent></Card>
      </div>

      <Card className="min-h-0 lg:col-span-12 lg:h-[28rem]"><CardHeader><CardTitle>{t("每日模型分布趋势")}</CardTitle><CardDescription>{t("按天比较各模型 Token；应用日期和项目筛选，保留全部模型。")}</CardDescription></CardHeader><CardContent className="min-h-0 lg:flex-1">
        {modelTrend.series.length && modelTrend.rows.length ? <ChartContainer config={modelTrend.config} className="h-80 w-full lg:h-full" aria-label={t("每日模型分布趋势") as string}>
          <BarChart accessibilityLayer data={modelTrend.rows} margin={{ left: 4, right: 8 }}><CartesianGrid vertical={false} /><XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} tick={{ className: "font-mono tabular-nums" }} tickFormatter={(value) => String(value).slice(5)} /><YAxis tickLine={false} axisLine={false} width={48} tick={{ className: "font-mono tabular-nums" }} tickFormatter={formatTokens} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => String(value)} formatter={(value, name, item) => { const model = modelTrend.series.find((entry) => entry.dataKey === name); const total = Number(item.payload?.totalTokens ?? 0); const percent = total ? Number(value) / total * 100 : 0; return <div className="flex min-w-48 justify-between gap-3"><span className="font-mono text-muted-foreground">{model?.label ?? String(name)}</span><span className="font-mono tabular-nums">{fullTokens(Number(value))} · {percent.toFixed(1)}%</span></div> }} />} />
            <ChartLegend content={<ChartLegendContent className="flex-wrap gap-y-2" />} />
            {modelTrend.series.map((model, index) => <Bar key={model.key} dataKey={model.dataKey} stackId="models" fill={`var(--color-${model.dataKey})`} radius={index === modelTrend.series.length - 1 ? [3, 3, 0, 0] : 0} />)}
          </BarChart>
        </ChartContainer> : <Empty className="h-64 lg:h-full"><EmptyHeader><EmptyTitle>{t("暂无模型趋势数据")}</EmptyTitle><EmptyDescription>{t("当前筛选范围内没有可归属到模型的 Token 数据。")}</EmptyDescription></EmptyHeader></Empty>}
      </CardContent></Card>

      <div className="grid grid-cols-1 gap-4 lg:col-span-12 lg:h-[29rem] lg:grid-cols-12">
      <ModelRankingCard title={t("模型分布")} description={t("保留全部模型用于比较，仅应用日期和项目筛选。") as string} data={data.models} />
      <ProjectRankingCard data={data.projects} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:col-span-12 lg:h-[23rem] lg:grid-cols-12">
      <Card className="min-h-0 lg:col-span-5 lg:h-full"><CardHeader><CardTitle>{t("工作负载")}</CardTitle><CardDescription>{t("任务与会话活动使用同一筛选范围。")}</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-4 text-sm lg:min-h-0 lg:flex-1 lg:auto-rows-fr">
        {[ [t("会话"), data.summary.sessions], [t("任务启动"), data.summary.tasksStarted], [t("任务完成"), data.summary.tasksCompleted], [t("任务完成率"), `${data.summary.completionPercent.toFixed(1)}%`], [t("中止"), data.summary.abortedTurns], [t("上下文压缩"), data.summary.compactions], [t("每完成任务 Token"), formatTokens(data.summary.tokensPerCompletedTask)] ].map(([label, value]) => <div key={String(label)} className="flex flex-col gap-1"><span className="text-xs text-muted-foreground">{label}</span><span className="font-mono text-lg font-medium tabular-nums">{value}</span></div>)}
      </CardContent></Card>

      <Card className="min-h-0 lg:col-span-7 lg:h-full"><CardHeader><CardTitle>{t("活跃热力图")}</CardTitle><CardDescription>{t("按本机时区汇总星期与小时的 Token 强度。")}</CardDescription></CardHeader><CardContent className="min-h-0 lg:flex-1"><ScrollArea className="h-full pb-3" aria-label={t("活跃热力图滚动区域") as string}><div className="grid min-w-[42rem] grid-cols-[2rem_repeat(24,minmax(1rem,1fr))] gap-1 lg:h-full lg:content-center" role="img" aria-label={t("星期和小时 Token 热力图") as string}>
        <span />{Array.from({ length: 24 }, (_, hour) => <span key={hour} className="text-center font-mono text-[10px] text-muted-foreground tabular-nums">{hour % 3 === 0 ? hour : ""}</span>)}
        {weekdays.flatMap((weekday) => [<span key={`${weekday}-label`} className="text-xs text-muted-foreground">{weekdayLabels[weekday]}</span>, ...Array.from({ length: 24 }, (_, hour) => { const value = heat.get(`${weekday}|${hour}`) ?? 0; const level = heatMax ? value / heatMax : 0; const label = `周${weekdayLabels[weekday]} ${hour}:00，${fullTokens(value)} Token`; return <Tooltip key={`${weekday}-${hour}`}><TooltipTrigger render={<span tabIndex={0} aria-label={label} className={cn("aspect-square rounded-sm bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring", level > 0 && "bg-primary/20", level > .25 && "bg-primary/40", level > .5 && "bg-primary/65", level > .75 && "bg-primary")} />} /><TooltipContent>{label}</TooltipContent></Tooltip> })])}
      </div><ScrollBar orientation="horizontal" /></ScrollArea></CardContent></Card>
      </div>

      <Card className="lg:col-span-12"><CardHeader><CardTitle>{t("数据覆盖")}</CardTitle><CardDescription>{t("白名单派生历史永久保留，不会随 Codex 会话文件清理而删除。")}</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          [t("统计会话"), data.coverage.rollouts], [t("当前源文件"), data.coverage.sourceRollouts], [t("永久保留"), data.coverage.retainedRollouts],
          [t("扫描完整性"), t(data.coverage.scan.complete ? "完整" : "不完整")], [t("待确认缺失"), data.coverage.scan.pendingMissingRollouts],
          [t("最早事件"), formatDate(data.coverage.firstEventAt)], [t("最新事件"), formatDate(data.coverage.lastEventAt)], [t("最近成功扫描"), formatDate(data.coverage.scan.lastSuccessfulAt)],
          [t("最近保留"), formatDate(data.coverage.lastRetentionAt)], [t("解析警告"), data.coverage.parseWarnings],
          [t("待同步审计"), data.coverage.retention.pendingAuditEvents], [t("审计最近校验"), formatDate(data.coverage.retention.lastVerifiedAt)],
          [t("快照状态"), t(data.coverage.backup.status)], [t("最近快照"), formatDate(data.coverage.backup.lastSuccessfulAt)], [t("快照代数"), data.coverage.backup.generations],
          [t("最近数据库恢复"), formatDate(data.coverage.backup.lastRecoveryAt)],
        ].map(([label, value]) => <div key={String(label)} className="flex min-w-0 flex-col gap-1"><span className="text-xs text-muted-foreground">{label}</span><span className="truncate font-mono text-sm tabular-nums" title={String(value)}>{value}</span></div>)}
      </CardContent></Card>
    </div> : data?.status === "scanning" ? <LoadingDashboard /> : null}
  </div>
}

function PageIntro() {
  const { t } = useTranslation()
  return <Alert><InfoIcon /><AlertTitle className="flex flex-wrap items-center gap-2">{t("本机 Codex 用量汇总")}<Badge variant="secondary">{t("本机汇总")}</Badge></AlertTitle><AlertDescription>{t("数据来自主 CODEX_HOME 中所有账号共同产生的会话记录，不能按账号拆分，也不代表账单或账号额度。")}</AlertDescription></Alert>
}
