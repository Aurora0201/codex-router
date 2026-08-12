import type { Header } from "@tanstack/react-table"

import { cn } from "@/lib/utils"

export function ColumnResizeHandle<T>({
  header,
}: {
  header: Header<T, unknown>
}) {
  if (!header.column.getCanResize()) return null

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${header.column.id} column`}
      className={cn(
        "absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none select-none after:absolute after:inset-y-2 after:right-0 after:w-px after:bg-border hover:after:bg-ring",
        header.column.getIsResizing() && "after:w-0.5 after:bg-primary"
      )}
      onMouseDown={header.getResizeHandler()}
      onTouchStart={header.getResizeHandler()}
      onDoubleClick={() => header.column.resetSize()}
    />
  )
}
