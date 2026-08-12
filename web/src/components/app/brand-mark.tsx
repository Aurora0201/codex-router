import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

const brandIconUrl = `${import.meta.env.BASE_URL}codex-router-icon.png`
const brandMaskStyle = {
  maskImage: `url("${brandIconUrl}")`,
  maskPosition: "center",
  maskRepeat: "no-repeat",
  maskSize: "contain",
  WebkitMaskImage: `url("${brandIconUrl}")`,
  WebkitMaskPosition: "center",
  WebkitMaskRepeat: "no-repeat",
  WebkitMaskSize: "contain",
}

export function BrandMark({ className, ...props }: { className?: string } & ComponentProps<"span">) {
  return (
    <span
      data-slot="brand-mark"
      aria-hidden="true"
      className={cn("shrink-0 bg-current", className)}
      style={brandMaskStyle}
      {...props}
    />
  )
}
