import { Unlink } from "lucide-react";
import { toast } from "sonner";
import { api, type Session } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { shortId } from "@/lib/format";

export function SessionsPage({ sessions, reload }: { sessions: Session[]; reload(): Promise<void> }) {
  const release = (session: Session) => void api.releaseSession(session.routingKey).then(() => { void reload(); toast.success("会话已释放"); });

  return (
    <TooltipProvider delayDuration={300}>
      <section className="space-y-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Sticky routing</p>
          <h1 className="mt-1 text-2xl font-semibold">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground">已有会话固定使用初始账号；切换当前账号不会迁移绑定。</p>
        </div>
        {sessions.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="font-semibold">暂无会话绑定</p>
            <p className="mt-1 text-sm text-muted-foreground">Codex 第一次通过 Gateway 请求后，会话会显示在这里。</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Session</TableHead>
                  <TableHead>Account ID</TableHead>
                  <TableHead>Transport</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.routingKey}>
                    <TableCell>
                      <p className="font-mono text-sm">{session.threadId ?? session.sessionId ?? session.routingKeyHash}</p>
                      <p className="mt-0.5 font-mono text-xs text-muted-foreground">hash {session.routingKeyHash}</p>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{shortId(session.accountChatgptId)}</TableCell>
                    <TableCell className="font-mono text-sm uppercase">{session.transport}</TableCell>
                    <TableCell>
                      <Badge variant={session.activeRequests > 0 ? "default" : "secondary"}>{session.activeRequests > 0 ? "Active" : session.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(session.lastSeenAt).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button variant="ghost" size="sm" disabled={session.activeRequests > 0} onClick={() => release(session)}>
                              <Unlink className="size-4" />Release
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{session.activeRequests > 0 ? "会话仍在使用中" : "释放此会话"}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </TooltipProvider>
  );
}
