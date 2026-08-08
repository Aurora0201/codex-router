import { ArrowRight, Cable, ShieldCheck } from "lucide-react";
import { shortId } from "@/lib/format";

export function TransportTrace({ account }: { account?: string | null }) {
  return (
    <div className="transport-trace grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 rounded-lg border bg-muted px-4 py-3 text-xs">
      <span className="flex items-center gap-2 font-semibold"><Cable className="size-3.5" />Codex</span>
      <ArrowRight className="size-3 text-muted-foreground" />
      <span className="text-center font-mono text-primary">127.0.0.1</span>
      <ArrowRight className="size-3 text-muted-foreground" />
      <span className="flex items-center justify-end gap-2 truncate"><ShieldCheck className="size-3.5" />{account ? shortId(account, 10, 6) : "等待账号"}</span>
    </div>
  );
}
