import type { ComponentProps } from "react"

import { ItemMedia } from "@/components/ui/item"
import { cn } from "@/lib/utils"

export function MetricIconMedia({
  className,
  ...props
}: ComponentProps<typeof ItemMedia>) {
  return (
    <ItemMedia
      variant="icon"
      className={cn(
        "size-11 self-center! translate-y-0! rounded-md bg-background [&_svg]:size-[1.375rem]! [&_[data-slot=metric-mark]]:size-[1.375rem]",
        className
      )}
      {...props}
    />
  )
}
