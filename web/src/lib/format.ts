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
  if (minutes % 10080 === 0) {
    const weeks = minutes / 10080
    return weeks === 1
      ? i18n.t("周额度")
      : i18n.t("{{count}} 周额度", { count: weeks })
  }
  if (minutes % 1440 === 0)
    return i18n.t("{{count}} 天额度", { count: minutes / 1440 })
  if (minutes % 60 === 0)
    return i18n.t("{{count}} 小时额度", { count: minutes / 60 })
  return i18n.t("{{count}} 分钟额度", { count: minutes })
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
