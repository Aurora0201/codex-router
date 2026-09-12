import type { ReactNode } from "react"
import type { GaugeIcon } from "lucide-react"

/**
 * A block of related settings. The sheet is the panel, so a section is its one
 * inset: solid fill inside the outline, never an outline inside an outline.
 */
export function Section({
  title,
  icon: Icon,
  hint,
  description,
  control,
  children,
}: {
  title: string
  icon: typeof GaugeIcon
  hint?: string
  description?: string
  /**
   * A control for the section as a whole, sitting on the heading. It centres
   * on the heading block rather than on a row, which is the only way a section
   * holding nothing else can have even margins above and below it.
   */
  control?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="rounded-xl bg-muted p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <header className="flex h-6 items-center gap-2">
            <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
            <h3 className="flex-1 text-sm font-semibold">{title}</h3>
            {hint ? (
              <span className="text-xs text-muted-foreground-subtle">
                {hint}
              </span>
            ) : null}
          </header>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {control}
      </div>
      {/* Matches the section's own padding, so the gap under the header and
          the gap above the bottom edge read as one rhythm. */}
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  )
}
