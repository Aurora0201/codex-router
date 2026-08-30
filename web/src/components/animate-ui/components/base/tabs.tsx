import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
} from "motion/react"

import { cn } from "@/lib/utils"

type TabsContextValue = {
  highlightId: string
  value: string | undefined
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

type TabsProps = React.ComponentProps<typeof TabsPrimitive.Root>

function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  ...props
}: TabsProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue)
  const activeValue = value ?? internalValue
  const highlightId = React.useId()

  return (
    <TabsContext.Provider value={{ highlightId, value: activeValue }}>
      <TabsPrimitive.Root
        data-slot="animate-tabs"
        value={value}
        defaultValue={defaultValue}
        onValueChange={(nextValue, eventDetails) => {
          if (value === undefined) setInternalValue(nextValue)
          onValueChange?.(nextValue, eventDetails)
        }}
        className={cn("flex flex-col gap-2", className)}
        {...props}
      />
    </TabsContext.Provider>
  )
}

type TabsListProps = React.ComponentProps<typeof TabsPrimitive.List>

function TabsList({ className, ...props }: TabsListProps) {
  return (
    <TabsPrimitive.List
      data-slot="animate-tabs-list"
      className={cn(
        "inline-flex h-9 w-fit items-center justify-center rounded-lg bg-muted p-[3px] text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

type TabsTabProps = React.ComponentProps<typeof TabsPrimitive.Tab>

function TabsTab({ className, children, value, ...props }: TabsTabProps) {
  const context = React.useContext(TabsContext)
  const reducedMotion = useReducedMotion()
  if (!context) throw new Error("TabsTab must be used within Tabs")
  const selected = context.value === value

  return (
    <TabsPrimitive.Tab
      data-slot="animate-tabs-tab"
      value={value}
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-active:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <AnimatePresence initial={false}>
        {selected ? (
          <motion.span
            layoutId={`tabs-highlight-${context.highlightId}`}
            className="absolute inset-0 rounded-md border border-transparent bg-background shadow-sm dark:border-input dark:bg-input/30"
            transition={
              reducedMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 200, damping: 25 }
            }
          />
        ) : null}
      </AnimatePresence>
      <span className="relative z-10 inline-flex items-center justify-center gap-1.5">
        {children}
      </span>
    </TabsPrimitive.Tab>
  )
}

type TabsPanelsProps = React.ComponentProps<typeof motion.div> & {
  mode?: "auto-height" | "layout"
}

function TabsPanels({
  mode = "auto-height",
  className,
  style,
  ...props
}: TabsPanelsProps) {
  const reducedMotion = useReducedMotion()

  return (
    <motion.div
      data-slot="animate-tabs-panels"
      layout={reducedMotion ? false : mode === "layout" ? "size" : true}
      className={cn("min-w-0", className)}
      style={{ overflow: "hidden", ...style }}
      transition={
        reducedMotion
          ? { layout: { duration: 0 } }
          : { layout: { type: "spring", stiffness: 200, damping: 30 } }
      }
      {...props}
    />
  )
}

type TabsPanelProps = React.ComponentProps<typeof TabsPrimitive.Panel> & {
  transition?: Transition
}

function TabsPanel({ className, transition, ...props }: TabsPanelProps) {
  const reducedMotion = useReducedMotion()

  return (
    <TabsPrimitive.Panel
      data-slot="animate-tabs-panel"
      render={
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reducedMotion
              ? { duration: 0 }
              : (transition ?? { duration: 0.18, ease: "easeOut" })
          }
        />
      }
      className={cn("min-w-0 outline-none", className)}
      {...props}
    />
  )
}

export {
  Tabs,
  TabsList,
  TabsTab,
  TabsPanels,
  TabsPanel,
  type TabsProps,
  type TabsListProps,
  type TabsTabProps,
  type TabsPanelsProps,
  type TabsPanelProps,
}
