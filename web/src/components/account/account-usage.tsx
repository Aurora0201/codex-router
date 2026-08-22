import { useTranslation } from "react-i18next"

import { Progress, ProgressValue } from "@/components/ui/progress"
import { QUOTA_TIGHT_PERCENT, remainingPercent } from "@/lib/account-state"
import { formatRelativeTime, formatUsageWindow } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { UsageWindowView } from "@/services/contracts"

/**
 * Fixed tracks, so every meter in the list occupies the same geometry no matter
 * what sits to its right. The bar is deliberately short: it is a glanceable
 * shape next to the number, not the number itself.
 */
const METER_COLUMNS =
  "grid-cols-[5.5rem_minmax(0,9rem)_2.75rem_6.5rem] items-center gap-x-2.5"

/**
 * One quota window on one text line. The bar fills with what is left, not what
 * was spent, so a fuller bar always means a better account to route through.
 * The shape never changes between states; only the emphasis moves.
 */
export function QuotaMeter({
  window,
  className,
}: {
  window: UsageWindowView
  className?: string
}) {
  const { t } = useTranslation()
  const label = formatUsageWindow(window)
  const remaining = remainingPercent(window)

  if (remaining === null) {
    return (
      <div
        className={cn("grid h-5 text-xs", METER_COLUMNS, className)}
        data-slot="quota-meter"
      >
        <span className="truncate text-muted-foreground">{label}</span>
        <span className="col-span-3 text-muted-foreground">{t("未报告")}</span>
      </div>
    )
  }

  const empty = remaining <= 0
  const tight = !empty && remaining <= QUOTA_TIGHT_PERCENT

  return (
    <Progress
      value={remaining}
      aria-label={t("{{label}}剩余", { label })}
      data-slot="quota-meter"
      className={cn(
        "grid h-5",
        METER_COLUMNS,
        "[&_[data-slot=progress-track]]:order-2",
        empty
          ? "[&_[data-slot=progress-indicator]]:bg-destructive"
          : tight
            ? "[&_[data-slot=progress-indicator]]:bg-warning"
            : "[&_[data-slot=progress-indicator]]:bg-primary",
        className
      )}
    >
      {/* A plain span, not ProgressLabel: base-ui would wire it as aria-labelledby
          and shadow the fuller aria-label above. */}
      <span className="order-1 truncate text-xs text-muted-foreground">
        {label}
      </span>
      <ProgressValue
        className={cn(
          "order-3 ml-0 text-right font-mono text-xs tabular-nums",
          empty && "text-destructive",
          tight && "text-warning"
        )}
      >
        {() => t("{{value}}%", { value: Math.round(remaining) })}
      </ProgressValue>
      <span
        className={cn(
          "order-4 truncate text-right text-xs",
          empty ? "font-medium text-foreground" : "text-muted-foreground"
        )}
      >
        {window.resetsAt === null
          ? t("回满时间未知")
          : t("{{time}}回满", { time: formatRelativeTime(window.resetsAt) })}
      </span>
    </Progress>
  )
}
