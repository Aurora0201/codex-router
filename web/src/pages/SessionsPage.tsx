import { Unlink } from "lucide-react";
import { api, type Session } from "../lib/api";
import { Badge, Button, Card, Empty } from "../components/ui";

export function SessionsPage({ sessions, reload }: { sessions: Session[]; reload(): Promise<void> }) {
  return <section className="space-y-4"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Sticky routing</p><h1 className="mt-1 text-2xl font-semibold">Sessions</h1><p className="mt-1 text-sm text-muted-foreground">已有会话固定使用初始账号；切换默认账号不会迁移绑定。</p></div>
    {sessions.length === 0 ? <Empty title="暂无会话绑定" detail="Codex 第一次通过 Gateway 请求后，会话会显示在这里。" /> : <div className="grid gap-3">{sessions.map((session) => <Card key={session.routingKey} className="grid gap-4 md:grid-cols-[1.4fr_1fr_.6fr_.7fr_auto] md:items-center">
      <div><p className="font-mono text-sm">{session.threadId ?? session.sessionId ?? session.routingKeyHash}</p><p className="mt-1 font-mono text-xs text-muted-foreground">hash {session.routingKeyHash}</p></div><div><p className="text-xs text-muted-foreground">Account</p><p className="mt-1 text-sm font-semibold">{session.accountLabel}</p></div><div><p className="text-xs text-muted-foreground">Transport</p><p className="mt-1 font-mono text-sm uppercase">{session.transport}</p></div><div><Badge tone={session.activeRequests > 0 ? "good" : "neutral"}>{session.activeRequests > 0 ? "Active" : session.status}</Badge><p className="mt-1 text-xs text-muted-foreground">{new Date(session.lastSeenAt).toLocaleString()}</p></div><Button variant="ghost" disabled={session.activeRequests > 0} onClick={() => void api.releaseSession(session.routingKey).then(reload)}><Unlink size={15} />Release</Button>
    </Card>)}</div>}
  </section>;
}
