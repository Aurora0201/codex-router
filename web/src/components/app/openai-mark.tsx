import openAiIconUrl from "@lobehub/icons-static-svg/icons/openai.svg"

import { cn } from "@/lib/utils"

const maskStyle = {
  maskImage: `url("${openAiIconUrl}")`,
  maskPosition: "center",
  maskRepeat: "no-repeat",
  maskSize: "contain",
  WebkitMaskImage: `url("${openAiIconUrl}")`,
  WebkitMaskPosition: "center",
  WebkitMaskRepeat: "no-repeat",
  WebkitMaskSize: "contain",
}

/**
 * The OpenAI wordmark drawn as a mask over `currentColor`, so it inherits the
 * surrounding text colour instead of shipping a second themed asset.
 */
export function OpenAiMark({ className }: { className?: string }) {
  return (
    <span
      data-slot="metric-mark"
      aria-hidden="true"
      className={cn("bg-current", className)}
      style={maskStyle}
    />
  )
}
