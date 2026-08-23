import { useTranslation } from "react-i18next"

import { Progress, ProgressValue } from "@/components/ui/progress"
import { QUOTA_TIGHT_PERCENT, remainingPercent } from "@/lib/account-state"
import { formatCountdown, formatUsageWindow } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { UsageWindowView } from "@/services/contracts"

/**
 * The meter spans both row baselines: the window name, its bar and its
 * percentage share the first line, so the bar fills the space between the label
 * and the number instead of leaving a void under them. The reset countdown sits
 * on the second line, under the name it belongs to.
 */
const METER =
  "row-span-2 grid grid-rows-subgrid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 text-xs"
const TRACK =
  "[&>[data-slot=progress-track]]:col-start-2 [&>[data-slot=progress-track]]:row-start-1 [&>[data-slot=progress-track]]:h-[3px]"
const LABEL = "col-start-1 row-start-1 truncate text-muted-foreground"
const VALUE = "col-start-3 row-start-1 w-9 text-right font-mono tabular-nums"
const CAPTION = "col-span-3 row-start-2 truncate text-muted-foreground"

/**
 * One quota window. The bar fills with what is left, not what was spent, so a
 * fuller bar always means a better account to route through. The shape never
 * changes between states; only the emphasis moves.
 */
export function QuotaMeter({
  window,
  placeholderMins,
  known = true,
  live = false,
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
  /**
   * Whether this meter belongs to the account traffic is routed through. Colour
   * is reserved for that one fact, so a healthy standby row stays neutral and
   * the warning and exhausted tones keep their force.
   */
  live?: boolean
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
  // rows below keep their alignment.
  if (!window || remaining === null) {
    return (
      <div
        data-slot="quota-meter"
        aria-label={label}
        className={cn(METER, className)}
      >
        <span className={LABEL}>{label}</span>
        {/* No cap means nothing is spent, so the rule is drawn full rather than
            empty. It is not a progressbar: there is no measurement behind it. */}
        <div
          data-slot="quota-bar"
          className={cn(
            "col-start-2 row-start-1 h-[3px] rounded-full",
            !window && known
              ? live
                ? "bg-primary"
                : "bg-foreground/25"
              : "bg-muted/60"
          )}
        />
        <span className={cn(VALUE, "w-auto font-sans text-muted-foreground")}>
          {/* A window reported without a number is 未报告; an absent window on
              a bucket upstream did report means there is no such cap. */}
          {window ? t("未报告") : known ? t("无限制") : fallback}
        </span>
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
        METER,
        TRACK,
        empty
          ? "[&_[data-slot=progress-indicator]]:bg-destructive"
          : tight
            ? "[&_[data-slot=progress-indicator]]:bg-warning"
            : live
              ? "[&_[data-slot=progress-indicator]]:bg-primary"
              : "[&_[data-slot=progress-indicator]]:bg-foreground/25",
        className
      )}
    >
      {/* A plain span, not ProgressLabel: base-ui would wire it as
          aria-labelledby and shadow the fuller aria-label above. */}
      <span className={LABEL}>{label}</span>
      <ProgressValue
        className={cn(
          VALUE,
          "ml-0",
          empty && "text-destructive",
          tight && "text-warning"
        )}
      >
        {() => t("{{value}}%", { value: Math.round(remaining) })}
      </ProgressValue>
      <span className={cn(CAPTION, empty && "font-medium text-foreground")}>
        {t("{{time}}重置", { time: formatCountdown(window.resetsAt) })}
      </span>
    </Progress>
  )
}
