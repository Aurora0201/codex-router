import type { AccountView, CodexStatusView } from "@/services/contracts"

/**
 * The six ways the takeover can stand. Derived rather than reported, because
 * the gateway has no single field for it: it falls out of whether Codex has a
 * config, whether we rewrote it, whether Codex is up, and whether the account
 * pool can supply an identity.
 */
export type RuntimeState =
  | "config_missing"
  | "not_applied"
  | "codex_stopped"
  | "passthrough"
  | "managed"
  | "route_blocked"

export function runtimeState(
  status: CodexStatusView,
  accounts: AccountView[]
): RuntimeState {
  const active = accounts.find((account) => account.isActive) ?? null
  const activeReady = active?.enabled === true && active.authStatus === "ready"
  if (!status.configExists) return "config_missing"
  if (!status.applied) return "not_applied"
  if (!status.codexRunning) return "codex_stopped"
  if (accounts.length === 0) return "passthrough"
  return activeReady ? "managed" : "route_blocked"
}

/** Requests only reach us once the config is rewritten. */
export function isIntercepting(state: RuntimeState): boolean {
  return state !== "config_missing" && state !== "not_applied"
}

export function runtimeTone(
  state: RuntimeState
): "success" | "warning" | "destructive" {
  if (state === "managed" || state === "passthrough") return "success"
  if (state === "config_missing" || state === "route_blocked")
    return "destructive"
  return "warning"
}
