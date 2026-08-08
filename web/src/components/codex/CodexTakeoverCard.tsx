import { useCallback, useEffect, useState } from "react";
import { RefreshCw, RotateCcw, Rocket, Wrench } from "lucide-react";
import { toast } from "sonner";
import { api, type CodexStatus } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { shortId } from "@/lib/format";

type ConfirmAction = "apply" | "restore" | "restart" | null;

export function CodexTakeoverCard() {
  const [status, setStatus] = useState<CodexStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<ConfirmAction>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.codexStatus());
      setError("");
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void api.codexStatus().then(setStatus).catch(() => undefined), 5_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const run = async (key: string, operation: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await operation();
      setStatus(await api.codexStatus());
      toast.success(message);
    } catch (reason) {
      setError((reason as Error).message);
      toast.error((reason as Error).message);
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const confirmLabel = (action: ConfirmAction): string => {
    switch (action) {
      case "apply": return "替换为 Gateway？";
      case "restore": return "恢复原配置？";
      case "restart": return "重启 Codex？";
      default: return "";
    }
  };

  return (
    <Card>
      <CardContent className="grid gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold"><Wrench className="size-4" />Codex 接管</h2>
          <div className="flex items-center gap-2">
            <Badge variant={status?.applied ? "default" : "secondary"}>{status?.applied ? "已接管" : status?.configExists ? "未接管" : "配置缺失"}</Badge>
            <Badge variant={status?.codexRunning ? "default" : "outline"}>{status?.codexRunning ? "Codex 运行中" : "Codex 未运行"}</Badge>
            <Button variant="ghost" size="icon" className="size-8" aria-label="刷新状态" onClick={() => void load()}><RefreshCw className="size-4" /></Button>
          </div>
        </div>

        <dl className="grid gap-2 text-sm">
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <dt className="text-muted-foreground">配置</dt>
            <dd className="break-all font-mono text-xs">{status?.configPath ?? "—"}</dd>
          </div>
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <dt className="text-muted-foreground">目标</dt>
            <dd className="break-all font-mono text-xs">{status?.gatewayBaseUrl ?? "—"}</dd>
          </div>
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <dt className="text-muted-foreground">当前</dt>
            <dd className="break-all font-mono text-xs">{status?.openaiBaseUrl ?? "（默认 ChatGPT 路径）"}</dd>
          </div>
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <dt className="text-muted-foreground">模型目录</dt>
            <dd className="break-all font-mono text-xs">{status?.modelCatalogJson ?? "（从 Gateway /models 获取）"}</dd>
          </div>
        </dl>

        {error ? <Alert variant="destructive"><AlertTitle>操作失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

        <Alert>
          <AlertTitle>如何接管</AlertTitle>
          <AlertDescription>
            将 Codex 主配置的 <span className="font-mono">openai_base_url</span> 指向本 Gateway，使模型流量（responses / compact / models）经此代理。替换前会自动备份原配置，可随时恢复。切换只影响新请求。
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" disabled={!status?.hasBackup || busy !== null || !status?.applied} onClick={() => setConfirm("restore")}>
            <RotateCcw className="size-4" />恢复原配置
          </Button>
          <Button disabled={!status?.configExists || busy !== null || status?.applied} onClick={() => setConfirm("apply")}>
            <Rocket className="size-4" />替换为 Gateway
          </Button>
        </div>

        <div className="border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              重启主 Codex 进程，使配置生效。{status?.codexRunning ? `当前检测到运行中的进程${status?.openaiBaseUrl ? `（${shortId(status.openaiBaseUrl)}）` : ""}。` : "当前未检测到运行中的 Codex 进程。"}
            </p>
            <Button variant="outline" disabled={busy !== null} onClick={() => setConfirm("restart")}>
              <RefreshCw className="size-4" />{busy === "restart" ? "重启中…" : "重启 Codex"}
            </Button>
          </div>
        </div>
      </CardContent>

      <AlertDialog open={confirm != null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmLabel(confirm)}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "apply" && "将备份当前配置并把 openai_base_url 指向本 Gateway。已绑定的旧会话不受影响。"}
              {confirm === "restore" && "将从备份还原 config.toml，恢复原始请求路径。"}
              {confirm === "restart" && "若 Codex 正在处理任务，重启会中断它。确认继续？"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={() => {
                if (confirm === "apply") void run("apply", () => api.codexApplyConfig(), "已替换为 Gateway");
                if (confirm === "restore") void run("restore", () => api.codexRestoreConfig(), "已恢复原配置");
                if (confirm === "restart") void run("restart", () => api.codexRestart(), "Codex 已重启");
              }}
            >
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
