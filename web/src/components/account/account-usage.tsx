import { useTranslation } from "react-i18next"

import { Progress, ProgressValue } from "@/components/ui/progress"
import {
  QUOTA_CRITICAL_PERCENT,
  QUOTA_TIGHT_PERCENT,
  remainingPercent,
} from "@/lib/account-state"
import { formatCountdown, formatUsageWindow } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { UsageWindowView } from "@/services/contracts"

const METER = "grid gap-1.5"
const HEAD = "flex items-center justify-between gap-4 text-xs font-medium"
const TRACK =
  "[&>[data-slot=progress-track]]:h-1.5 [&>[data-slot=progress-track]]:bg-foreground/15"
const CAPTION = "text-[11px] text-muted-foreground/70"

/**
 * One quota window inside an account card: name and remaining percentage on the
 * first line, the bar under them, and the reset countdown beneath. The bar
 * fills with what is left, not what was spent, so a fuller bar always means a
 * better account to route through.
 */
export function QuotaMeter({
  window,
  placeholderMins,
  known = true,
  fallback,
  className,
}: {
  window: UsageWindowView | null
  /** Names the slot when upstream omitted the window itself. */
  placeholderMins?: number
  /**
   * Whether upstream reported this bucket at all. When it did, an absent window
   * means there is no such cap; when it did not, an absent window means nothing
   * is known and the slot must not claim otherwise.
   */
  known?: boolean
  /** Shown on one unknown slot; repeating it on both is just noise. */
  fallback?: string
  className?: string
}) {
  const { t } = useTranslation()
  const remaining = window ? remainingPercent(window) : null
  const label = formatUsageWindow(
    window ??
      (placeholderMins !== undefined
        ? {
            usedPercent: null,
            resetsAt: null,
            windowDurationMins: placeholderMins,
          }
        : null)
  )

  // An empty slot still holds its place, so both windows stay on screen and the
  // cards keep the same height.
  if (!window || remaining === null) {
    const uncapped = !window && known
    return (
      <div
        data-slot="quota-meter"
        aria-label={label}
        className={cn(METER, className)}
      >
        <div className={HEAD}>
          <span className="truncate">{label}</span>
          <span
            aria-hidden="true"
            className="shrink-0 text-muted-foreground tabular-nums"
          >
            {uncapped ? "∞" : null}
          </span>
        </div>
        {/* No cap means nothing is spent, so the rule is drawn full rather than
            empty. It is not a progressbar: there is no measurement behind it. */}
        <div
          data-slot="quota-bar"
          className={cn(
            "h-1.5 rounded-full",
            uncapped ? "bg-primary" : "bg-foreground/15"
          )}
        />
        <span className={CAPTION}>
          {/* A window reported without a number is 未报告; an absent window on
              a bucket upstream did report means there is no such cap. */}
          {window ? t("未报告") : uncapped ? t("无限制") : fallback}
        </span>
      </div>
    )
  }

  const empty = remaining <= 0
  const critical = remaining <= QUOTA_CRITICAL_PERCENT
  const tight = !critical && remaining <= QUOTA_TIGHT_PERCENT

  return (
    <Progress
      value={remaining}
      aria-label={t("{{label}}剩余", { label })}
      data-slot="quota-meter"
      className={cn(
        METER,
        TRACK,
        critical
          ? "[&_[data-slot=progress-indicator]]:bg-destructive"
          : tight
            ? "[&_[data-slot=progress-indicator]]:bg-warning"
            : "[&_[data-slot=progress-indicator]]:bg-primary",
        className
      )}
    >
      <div className={HEAD}>
        {/* A plain span, not ProgressLabel: base-ui would wire it as
            aria-labelledby and shadow the fuller aria-label above. */}
        <span className="truncate">{label}</span>
        <ProgressValue
          className={cn(
            "ml-0 shrink-0 tabular-nums",
            critical
              ? "text-destructive"
              : tight
                ? "text-warning"
                : "text-muted-foreground"
          )}
        >
          {() => t("{{value}}%", { value: Math.round(remaining) })}
        </ProgressValue>
      </div>
      {/* Progress appends its own track last, so the caption is ordered past it. */}
      <span
        className={cn(
          "order-3",
          CAPTION,
          empty && "font-medium text-foreground"
        )}
      >
        {t("{{time}}重置", { time: formatCountdown(window.resetsAt) })}
      </span>
    </Progress>
  )
}
