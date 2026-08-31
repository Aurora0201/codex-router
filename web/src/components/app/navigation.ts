import type { LucideIcon } from "lucide-react"
import {
  ChartNoAxesCombinedIcon,
  ScrollTextIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  UsersRoundIcon,
} from "lucide-react"

export type NavItem = {
  value: AppPage
  label: string
  icon: LucideIcon
  chord: string
}

export type AppPage = "accounts" | "usage" | "gateway" | "logs" | "preferences"

/**
 * `g` then a letter, the way developer tools have done it for years. Modifier
 * digits were the obvious choice and are unusable here: every browser reserves
 * Cmd/Ctrl+1–8 for switching tabs, so the page never sees the event and a
 * printed "⌘1" would be a lie.
 */
export const NAV_CHORD_PREFIX = "g"

export const navigation: NavItem[] = [
  {
    value: "accounts" as const,
    label: "账号路由",
    icon: UsersRoundIcon,
    chord: "a",
  },
  {
    value: "usage" as const,
    label: "用量分析",
    icon: ChartNoAxesCombinedIcon,
    chord: "u",
  },
  {
    value: "gateway" as const,
    label: "运行状态",
    icon: Settings2Icon,
    chord: "r",
  },
  {
    value: "logs" as const,
    label: "请求日志",
    icon: ScrollTextIcon,
    chord: "l",
  },
]

/** Not a fifth working page, so it does not queue with the four that are. */
export const settingsItem: NavItem = {
  value: "preferences" as const,
  label: "偏好设置",
  icon: SlidersHorizontalIcon,
  chord: "p",
}

export const NAV_CHORDS: Record<string, AppPage> = Object.fromEntries(
  [...navigation, settingsItem].map((item) => [item.chord, item.value])
)
