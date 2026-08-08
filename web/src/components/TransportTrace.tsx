import { ArrowRight, Cable, ShieldCheck } from "lucide-react";

export function TransportTrace({ account }: { account?: string }) {
  return <div className="transport-trace grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 rounded-lg border bg-card-raised px-4 py-3 text-xs">
    <span className="flex items-center gap-2 font-semibold"><Cable size={14} />Codex</span><ArrowRight size={13} className="text-muted-foreground" />
    <span className="text-center font-mono text-primary">127.0.0.1</span><ArrowRight size={13} className="text-muted-foreground" />
    <span className="flex items-center justify-end gap-2 truncate"><ShieldCheck size={14} />{account ?? "等待账号"}</span>
  </div>;
}
