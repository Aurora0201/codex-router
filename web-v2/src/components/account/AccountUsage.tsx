import { Progress } from "@/components/ui/progress"
import { formatRelativeTime, formatUsageWindowName } from "@/lib/format"
import type { UsageWindow } from "@/services/contracts"

export function AccountUsage({ window, fallbackLabel, compact = false }: { window: UsageWindow | null; fallbackLabel: string; compact?: boolean }) {
  const label = formatUsageWindowName(window?.windowDurationMins ?? null, fallbackLabel)
  if (window == null || window.usedPercent == null) return compact
    ? <div className="grid min-w-0 grid-cols-[7rem_1fr] items-center gap-3 py-1"><p className="truncate text-xs font-medium">{label}</p><p className="text-xs text-muted-foreground">暂无上游数据</p></div>
    : <div className="rounded-2xl bg-muted/55 p-3"><p className="text-sm font-medium">{label}</p><p className="mt-1 text-sm text-muted-foreground">暂无上游数据</p></div>
  const value = Math.max(0, Math.min(100, window.usedPercent))
  if (compact) return <div className="grid min-w-0 grid-cols-[7rem_minmax(6rem,1fr)_5.5rem_7rem] items-center gap-3 py-1"><p className="truncate text-xs font-medium">{label}</p><Progress value={value} aria-label={`${label}已使用 ${value}%`} /><p className="whitespace-nowrap text-right font-mono text-xs font-medium tabular-nums">已使用 {value}%</p><p className="whitespace-nowrap text-right text-xs text-muted-foreground">{formatRelativeTime(window.resetsAt)}重置</p></div>
  return <div className="space-y-2 rounded-2xl bg-muted/55 p-3"><div className="flex items-center justify-between gap-2 text-sm"><span className="font-medium">{label}</span><span className="font-mono text-xs font-medium tabular-nums">已使用 {value}%</span></div><Progress value={value} aria-label={`${label}已使用 ${value}%`} /><p className="text-xs text-muted-foreground">{formatRelativeTime(window.resetsAt)}重置</p></div>
}
