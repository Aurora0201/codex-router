import { Progress } from "@/components/ui/progress"
import { formatRelativeTime, formatUsageWindow } from "@/lib/format"
import type { UsageWindowView } from "@/services/contracts"

function UsageLine({ window }: { window: UsageWindowView | null }) {
  const reported = window?.usedPercent != null
  return (
    <div className="grid grid-cols-[5.5rem_minmax(4rem,1fr)] items-center gap-x-3 gap-y-1 text-xs sm:grid-cols-[6.5rem_minmax(5rem,1fr)_8rem]">
      <span className="font-medium">{formatUsageWindow(window)}</span>
      <Progress
        value={reported ? (window.usedPercent ?? 0) : null}
        aria-label={
          reported
            ? `${formatUsageWindow(window)}使用量`
            : `${formatUsageWindow(window)}未报告`
        }
      />
      <span className="col-span-2 text-right text-muted-foreground sm:col-span-1">
        {reported
          ? `已使用 ${window.usedPercent}% · ${formatRelativeTime(window.resetsAt)}重置`
          : "Not reported"}
      </span>
    </div>
  )
}

export function AccountUsage({
  usage,
}: {
  usage: { primary: UsageWindowView | null; secondary: UsageWindowView | null }
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <UsageLine window={usage.primary} />
      <UsageLine window={usage.secondary} />
    </div>
  )
}
