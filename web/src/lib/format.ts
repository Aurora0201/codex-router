import type { AuthStatus, UsageWindowView } from "@/services/contracts"
import i18n from "@/i18n"

export function shortAccountId(value: string | null): string {
  if (!value) return "Account ID unavailable"
  if (value.length <= 15) return value
  return `${value.slice(0, 8)}…${value.slice(-4)}`
}

export function formatDateOnly(value: number | null): string {
  if (value === null) return "—"
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  }).format(value)
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

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return i18n.t("{{hours}} 小时 {{minutes}} 分钟", { hours, minutes })
}
