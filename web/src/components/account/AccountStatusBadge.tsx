import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { Account } from "@/lib/api";

const LABELS: Record<string, string> = {
  ready: "Ready",
  refreshing: "Refreshing",
  rate_limited: "Rate limited",
  relogin_required: "Re-login required",
  unsupported_fedramp: "FedRAMP unsupported",
  disabled: "Disabled",
  login_pending: "Login pending",
  error: "Error",
};

function toneFor(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "ready": return "default";
    case "refreshing":
    case "login_pending": return "secondary";
    case "disabled": return "outline";
    case "rate_limited":
    case "relogin_required":
    case "unsupported_fedramp":
    case "error": return "destructive";
    default: return "outline";
  }
}

export function AccountStatusBadge({ account, children }: { account: Account; children?: ReactNode }) {
  const label = LABELS[account.authStatus] ?? account.authStatus;
  return <Badge variant={toneFor(account.authStatus)}>{children ?? label}</Badge>;
}
