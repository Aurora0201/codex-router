import { useTranslation } from "react-i18next"

import { Progress, ProgressValue } from "@/components/ui/progress"
import { QUOTA_TIGHT_PERCENT, remainingPercent } from "@/lib/account-state"
import { formatRelativeTime, formatUsageWindow } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { UsageWindowView } from "@/services/contracts"

const TEXT_LINE = "flex h-4 items-center gap-2 text-xs"
/** A fixed slot, so a reported window and a placeholder occupy the same height. */
const SLOT = "block h-6 space-y-1"
const TRACK = "[&_[data-slot=progress-track]]:h-[3px]"

/**
 * One quota window as a labelled line with its bar drawn as a rule underneath,
 * so the number sits beside its own label instead of across a long bar.
 *
 * The bar fills with what is left, not what was spent, so a fuller bar always
 * means a better account to route through. The shape never changes between
 * states; only the emphasis moves.
 */
export function QuotaMeter({
  window,
  fallback,
  className,
}: {
  window: UsageWindowView | null
  /**
   * Shown when the window is missing entirely, e.g. limits were never fetched.
   * Only the first empty slot carries it; repeating it on both is just noise.
   */
  fallback?: string
  className?: string
}) {
  const { t } = useTranslation()
  const remaining = window ? remainingPercent(window) : null

  // An empty slot still holds its place, so both windows stay on screen and the
  // rows below keep their alignment.
  if (!window || remaining === null) {
    return (
      <div
        data-slot="quota-meter"
        className={cn(SLOT, className)}
        aria-label={window ? formatUsageWindow(window) : undefined}
      >
        <div className={TEXT_LINE}>
          {window ? (
            <span className="truncate text-muted-foreground">
              {formatUsageWindow(window)}
            </span>
          ) : null}
          {window || fallback ? (
            <span className="ml-auto shrink-0 truncate text-muted-foreground">
              {window ? t("未报告") : fallback}
            </span>
          ) : null}
        </div>
        <div className="h-[3px] rounded-full bg-muted/60" />
      </div>
    )
  }

  const empty = remaining <= 0
  const tight = !empty && remaining <= QUOTA_TIGHT_PERCENT
  const label = formatUsageWindow(window)

  return (
    <Progress
      value={remaining}
      aria-label={t("{{label}}剩余", { label })}
      data-slot="quota-meter"
      className={cn(
        SLOT,
        TRACK,
        empty
          ? "[&_[data-slot=progress-indicator]]:bg-destructive"
          : tight
            ? "[&_[data-slot=progress-indicator]]:bg-warning"
            : "[&_[data-slot=progress-indicator]]:bg-primary",
        className
      )}
    >
      <div className={TEXT_LINE}>
        {/* A plain span, not ProgressLabel: base-ui would wire it as
            aria-labelledby and shadow the fuller aria-label above. */}
        <span className="truncate text-muted-foreground">{label}</span>
        <span
          className={cn(
            "ml-auto shrink-0 truncate",
            empty ? "font-medium text-foreground" : "text-muted-foreground"
          )}
        >
          {window.resetsAt === null
            ? t("回满时间未知")
            : t("{{time}}回满", { time: formatRelativeTime(window.resetsAt) })}
        </span>
        <ProgressValue
          className={cn(
            "ml-0 w-9 shrink-0 text-right font-mono text-xs tabular-nums",
            empty && "text-destructive",
            tight && "text-warning"
          )}
        >
          {() => t("{{value}}%", { value: Math.round(remaining) })}
        </ProgressValue>
      </div>
    </Progress>
  )
}
