import { SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * The one search field in the console. The accounts list, the request log and
 * the connection log each carried their own copy of this markup, identical
 * down to the placeholder colour, which is three places to keep in step and
 * three chances not to.
 */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string
  onChange(value: string): void
  /** Names the field for a screen reader; the placeholder is not a label. */
  label: string
  placeholder: string
  className?: string
}) {
  return (
    <label
      className={cn(
        "flex h-9 w-full min-w-0 items-center gap-2 rounded-xl bg-muted px-3 text-muted-foreground sm:w-72",
        className
      )}
    >
      <SearchIcon aria-hidden="true" className="size-4 shrink-0" />
      <input
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground-subtle"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        placeholder={placeholder}
      />
    </label>
  )
}
