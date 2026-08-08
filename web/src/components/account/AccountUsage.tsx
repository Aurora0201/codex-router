import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { UsageWindowView } from "@/lib/api";
import { formatWindowDuration, formatResetsAt } from "@/lib/format";

interface UsageWindowProps {
  title: string;
  window: UsageWindowView | null;
  loading: boolean;
}

export function AccountUsage({ title, window, loading }: UsageWindowProps) {
  return (
    <div className="grid gap-1.5">
      <p className="text-xs text-muted-foreground">{title}</p>
      {loading ? (
        <div className="grid gap-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-2 w-full" />
        </div>
      ) : window == null ? (
        <p className="text-sm text-muted-foreground">Not reported</p>
      ) : (
        <div className="grid gap-1.5">
          <p className="text-sm font-medium">
            已使用 {window.usedPercent == null ? "—" : `${Math.max(0, Math.min(100, window.usedPercent))}%`}
          </p>
          <Progress value={window.usedPercent == null ? 0 : Math.max(0, Math.min(100, window.usedPercent))} />
          <p className="text-xs text-muted-foreground">
            {window.windowDurationMins == null ? "—" : formatWindowDuration(window.windowDurationMins)}
            {window.resetsAt != null ? ` · 约 ${formatResetsAt(window.resetsAt)} 后重置` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
