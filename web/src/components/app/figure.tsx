import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A panel's reading: what was measured, and the number it came to. Every one
 * of them is set the same, because the same kind of fact appearing at two
 * sizes on two pages is what made the console read as two products — the
 * runtime and usage pages set these a step smaller than the log page did.
 */
export function Figure({
  label,
  value,
  note,
  className,
}: {
  label: string
  value: string
  /** A share or a comparison the number is read against. */
  note?: string
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="truncate text-xs text-muted-foreground-subtle">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1.5">
        <span className="truncate text-lg leading-none font-semibold tabular-nums">
          {value}
        </span>
        {note ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {note}
          </span>
        ) : null}
      </dd>
    </div>
  )
}

/**
 * Reference material rather than a reading: a value you look up, not one you
 * compare against its neighbours. Label and value share a line so a column of
 * them is scanned down the left, and the value keeps the monospace it is
 * stored in.
 */
export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <dt className="truncate text-xs text-muted-foreground-subtle">{label}</dt>
      <dd
        className="min-w-0 shrink truncate font-mono text-sm tabular-nums"
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

/**
 * A counted thing, marked with an icon so a column of them is scanned by shape
 * rather than by reading every label. The connection overview and the workload
 * panel were the same six rows of markup written twice.
 */
export function Tally({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <dt className="flex min-w-0 items-center gap-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-card text-muted-foreground">
          <Icon aria-hidden="true" className="size-3.5" />
        </span>
        <span className="truncate text-muted-foreground">{label}：</span>
      </dt>
      <dd className="ml-auto shrink-0 font-mono font-semibold tabular-nums">
        {value}
      </dd>
    </div>
  )
}
