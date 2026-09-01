import type { AuthStatus, UsageWindowView } from "@/services/contracts"
import i18n from "@/i18n"
import { billingDaysRemaining } from "@/lib/billing-cycle"

export function shortAccountId(value: string | null): string {
  if (!value) return "Account ID unavailable"
  if (value.length <= 15) return value
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

export function formatDateOnly(value: number | null): string {
  if (value === null) return "—"
  const date = new Date(value)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${year}/${month}/${day}`
}

export function formatBillingCountdown(
  timestamp: number,
  now = Date.now()
): string {
  const days = billingDaysRemaining(timestamp, now)
  return days === 0 ? i18n.t("今天") : i18n.t("{{count}} 天后", { count: days })
}

export function formatUsageWindow(window: UsageWindowView | null): string {
  const minutes = window?.windowDurationMins
  if (!minutes) return i18n.t("用量额度")
  // A week reads as "7 天额度": the upstream window is a rolling duration, not a
  // calendar week, so the day count is the honest name for it.
  if (minutes % 1440 === 0)
    return i18n.t("{{count}} 天额度", { count: minutes / 1440 })
  if (minutes % 60 === 0)
    return i18n.t("{{count}} 小时额度", { count: minutes / 60 })
  return i18n.t("{{count}} 分钟额度", { count: minutes })
}

/**
 * A countdown to a reset, carried to two units so "3 天 5 小时后" says more than
 * "4 天后" about when an account actually comes back.
 */
export function formatCountdown(
  timestamp: number | null,
  now = Date.now()
): string {
  if (timestamp === null) return i18n.t("时间未知")
  const diff = timestamp - now
  if (diff <= 0) return i18n.t("即将")
  // Rounded, not floored: a reset 2 hours minus 3ms away should read "2 小时后".
  const minutes = Math.round(diff / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  // The minor unit is dropped when it is zero: "2 小时后" beats "2 小时 0 分钟后".
  if (days > 0)
    return hours > 0
      ? i18n.t("{{days}} 天 {{hours}} 小时后", { days, hours })
      : i18n.t("{{count}} 天后", { count: days })
  if (hours > 0)
    return minutes % 60 > 0
      ? i18n.t("{{hours}} 小时 {{minutes}} 分钟后", {
          hours,
          minutes: minutes % 60,
        })
      : i18n.t("{{count}} 小时后", { count: hours })
  return i18n.t("{{count}} 分钟后", { count: Math.max(1, minutes) })
}

export function formatRelativeTime(
  timestamp: number | null,
  now = Date.now()
): string {
  if (!timestamp) return i18n.t("尚未刷新")
  const diff = Math.max(0, timestamp - now)
  if (diff === 0) {
    const elapsed = Math.max(0, now - timestamp)
    if (elapsed < 60_000) return i18n.t("刚刚")
    if (elapsed < 3_600_000)
      return i18n.t("{{count}} 分钟前", { count: Math.floor(elapsed / 60_000) })
    return i18n.t("{{count}} 小时前", {
      count: Math.floor(elapsed / 3_600_000),
    })
  }
  if (diff < 3_600_000)
    return i18n.t("{{count}} 分钟后", { count: Math.ceil(diff / 60_000) })
  if (diff < 86_400_000)
    return i18n.t("{{count}} 小时后", { count: Math.ceil(diff / 3_600_000) })
  return i18n.t("{{count}} 天后", { count: Math.ceil(diff / 86_400_000) })
}

export function authStatusLabel(status: AuthStatus): string {
  return i18n.t(
    {
      login_pending: "等待登录",
      checking: "正在检查",
      ready: "认证就绪",
      refreshing: "正在刷新",
      rate_limited: "额度受限",
      relogin_required: "需要重新登录",
      unsupported_fedramp: "不支持 FedRAMP",
      disabled: "已停用",
      error: "认证异常",
    }[status]
  )
}

/**
 * Latency in the unit a person would say it in: milliseconds up to a second,
 * seconds past it. The raw figure arrives as a mean and carries a full float
 * of precision — "5034.614864864865 ms" is not a more accurate reading of a
 * gateway, only a longer one.
 */
export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—"
  const locale = i18n.resolvedLanguage ?? undefined
  if (ms < 1000) return `${Math.round(ms).toLocaleString(locale)} ms`
  const seconds = ms / 1000
  const digits = seconds < 10 ? 2 : 1
  return `${seconds.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} s`
}

/**
 * Payload size at the scale it happens to be. The log page's own version
 * stopped at kilobytes, so a long streamed response read as "4000.0 KB".
 */
export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—"
  const units = ["B", "KB", "MB", "GB"]
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`
}

/**
 * Whether a rendered value is machine text end to end, and so can take the
 * monospace face.
 *
 * Roboto Mono carries no CJK, so a mono span holding "2.9亿" or "正在运行"
 * renders the ASCII in Roboto and falls back to Noto Sans SC for the rest —
 * two faces inside one string. Deciding by the value rather than by the slot
 * it sits in is what keeps that from happening: a fact grid holds paths,
 * counts, timestamps and Chinese words in the same column, so the column
 * cannot answer the question for all of them.
 */
export function isMachineText(value: string): boolean {
  return /^[ -~—–]+$/.test(value)
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return i18n.t("{{hours}} 小时 {{minutes}} 分钟", { hours, minutes })
}
