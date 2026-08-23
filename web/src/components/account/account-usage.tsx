import { useTranslation } from "react-i18next"

import { Progress, ProgressValue } from "@/components/ui/progress"
import { QUOTA_TIGHT_PERCENT, remainingPercent } from "@/lib/account-state"
import { formatCountdown, formatUsageWindow } from "@/lib/format"
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
        className={cn(SLOT, className)}
        aria-label={label}
      >
        <div className={TEXT_LINE}>
          <span className="truncate text-muted-foreground">{label}</span>
          <span className="ml-auto shrink-0 truncate text-muted-foreground">
            {/* A window reported without a number is 未报告; an absent window on
                a bucket upstream did report means there is no such cap. */}
            {window ? t("未报告") : known ? t("无限制") : fallback}
          </span>
        </div>
        {/* No cap means nothing is spent, so the rule is drawn full rather than
            empty. It is not a progressbar: there is no measurement behind it. */}
        <div
          className={cn(
            "h-[3px] rounded-full",
            !window && known
              ? live
                ? "bg-primary"
                : "bg-foreground/25"
              : "bg-muted/60"
          )}
        />
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
        SLOT,
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
          {t("{{time}}重置", { time: formatCountdown(window.resetsAt) })}
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
