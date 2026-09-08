import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

function Slider({
  className,
  label,
  ...props
}: SliderPrimitive.Root.Props<number> & {
  /** Names the range input the thumb owns, which is what carries the role. */
  label?: string
}) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      // At either end a centred thumb hangs half outside the track, which puts
      // it up against whatever the track is sitting in.
      thumbAlignment="edge"
      className={cn("w-full data-disabled:opacity-50", className)}
      {...props}
    >
      <SliderPrimitive.Control className="flex w-full touch-none items-center py-1.5 select-none">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative h-1 w-full rounded-full bg-muted-foreground/20"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className="rounded-full bg-primary"
          />
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            getAriaLabel={label ? () => label : null}
            className="size-3.5 rounded-full border-2 border-primary bg-background outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-dragging:scale-110"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
