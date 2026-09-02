import {
  BanIcon,
  CheckCircle2Icon,
  CircleMinusIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { OUTCOME_LABELS, STATE_LABELS } from "@/lib/request-log"
import { cn } from "@/lib/utils"
import type { RequestOutcome, RequestState } from "@/services/contracts"

export function OutcomeBadge({
  outcome,
  state,
}: {
  outcome: RequestOutcome | null
  state?: RequestState
}) {
  const { t } = useTranslation()
  if (!outcome)
    return (
      <Badge variant="outline" className="text-warning">
        {t(STATE_LABELS[state ?? "running"])}
      </Badge>
    )
  const Icon =
    outcome === "success"
      ? CheckCircle2Icon
      : outcome === "client_cancelled"
        ? BanIcon
        : outcome === "rejected"
          ? CircleMinusIcon
          : TriangleAlertIcon
  return (
    <Badge
      variant="outline"
      className={cn(
        outcome === "success" && "text-success",
        outcome === "rejected" && "text-warning",
        (outcome === "upstream_error" || outcome === "gateway_error") &&
          "text-destructive",
        outcome === "client_cancelled" && "text-muted-foreground"
      )}
    >
      <Icon data-icon="inline-start" />
      {t(OUTCOME_LABELS[outcome])}
    </Badge>
  )
}
