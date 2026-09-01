import { isMachineText } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * A rendered value in the face that can render it whole: monospace when the
 * value is machine text end to end, the body face otherwise.
 *
 * Use this where the value is the entire contents of its own element. Where
 * the element already exists for other reasons — it carries a title, a
 * truncation, a flex role — apply `isMachineText` to its className instead;
 * the rule is the same, only the shape differs.
 */
export function MachineValue({
  value,
  className,
}: {
  value: string
  className?: string
}) {
  return (
    <span
      className={cn(
        "tabular-nums",
        isMachineText(value) && "font-mono",
        className
      )}
    >
      {value}
    </span>
  )
}
