import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Every block on the analytics and runtime pages is the same shell: a card
 * wrapping one solid inset. It started local to the usage page and moved here
 * the moment the runtime page needed the same shape.
 *
 * `action` replaces the hint when a panel owns a control of its own — a switch
 * belongs beside the title it obeys rather than in the page header.
 */
export function Panel({
  title,
  icon: Icon,
  hint,
  action,
  className,
  bodyClassName,
  busy,
  children,
}: {
  title: string
  icon: LucideIcon
  hint?: string
  action?: React.ReactNode
  className?: string
  bodyClassName?: string
  /** Marks the panel while its data reloads, for both the tone and readers. */
  busy?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      aria-busy={busy}
      className={cn(
        "flex flex-col rounded-2xl bg-card px-2 pb-2 ring-1 ring-foreground/10",
        className
      )}
    >
      {/* The complete top band is the header itself, so the icon, title and
          hint are centred between the card edge and the inset body. */}
      <header className="flex h-11 shrink-0 items-center justify-between gap-4 px-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="truncate">{title}</span>
        </h2>
        {action ??
          (hint ? (
            <span className="truncate text-xs text-muted-foreground/70">
              {hint}
            </span>
          ) : null)}
      </header>
      {/* flex-1 would set flex-basis:0 and beat any height a caller asks for,
          so stretching is opt-in rather than baked into the shell. */}
      <div
        className={cn("flex flex-col rounded-xl bg-muted p-3", bodyClassName)}
      >
        {children}
      </div>
    </section>
  )
}
