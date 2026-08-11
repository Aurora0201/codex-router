import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress"
import { useTranslation } from "react-i18next"
import { formatRelativeTime, formatUsageWindow } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { UsageWindowView } from "@/services/contracts"

function UsageLine({ window }: { window: UsageWindowView | null }) {
  const { t } = useTranslation()
  const reported = window?.usedPercent != null
  const label = formatUsageWindow(window)
  return (
    <Progress
      value={reported ? (window.usedPercent ?? 0) : null}
      aria-label={reported ? t("{{label}}使用量", { label }) : t("{{label}}未报告", { label })}
      className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 [&_[data-slot=progress-track]]:col-span-2"
    >
      <ProgressLabel className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0">{label}</span>
        <span className="truncate text-xs font-normal text-muted-foreground">
          ·{" "}
          {reported
            ? t("{{time}}重置", { time: formatRelativeTime(window.resetsAt) })
            : t("暂无额度数据")}
        </span>
      </ProgressLabel>
      <ProgressValue>
        {(formattedValue) => (reported ? formattedValue : t("未报告"))}
      </ProgressValue>
    </Progress>
  )
}

export function AccountUsage({
  usage,
  className,
}: {
  usage: { primary: UsageWindowView | null; secondary: UsageWindowView | null }
  className?: string
}) {
  return (
    <div
      data-slot="account-usage"
      className={cn(
        "grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-5",
        className
      )}
    >
      <UsageLine window={usage.primary} />
      <UsageLine window={usage.secondary} />
    </div>
  )
}
