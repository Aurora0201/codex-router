import { useState } from "react";
import { LockKeyhole, Save } from "lucide-react";
import { toast } from "sonner";
import { api, type Settings } from "../lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CodexTakeoverCard } from "@/components/codex/CodexTakeoverCard";

export function SettingsPage({ settings, reload }: { settings: Settings; reload(): Promise<void> }) {
  const [metadata, setMetadata] = useState(settings.requestMetadataLogging);
  const [theme, setTheme] = useState(settings.theme);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings({ requestMetadataLogging: metadata, theme });
      document.documentElement.dataset.theme = theme === "system" ? "" : theme;
      await reload();
      toast.success("设置已保存");
    } finally { setSaving(false); }
  };

  return (
    <section className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Local policy</p>
        <h1 className="mt-1 text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">网络边界和上游地址在运行时锁定，避免认证被发送到非预期目标。</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="grid gap-4 p-5">
            <h2 className="font-semibold">Gateway</h2>
            <dl className="grid gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Address</dt>
                <dd className="mt-1 font-mono">{settings.gatewayAddress}:{settings.gatewayPort}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Upstream</dt>
                <dd className="mt-1 break-all font-mono text-xs">{settings.upstream}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="grid gap-4 p-5">
            <h2 className="font-semibold">Privacy</h2>            <div className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="font-medium">Request metadata logging</span>
                <span className="block text-xs text-muted-foreground">仅状态、耗时、字节数和路由哈希</span>
              </span>
              <Switch checked={metadata} onCheckedChange={setMetadata} aria-label="Request metadata logging" />
            </div>
            <div className="flex items-center justify-between gap-4 text-sm">
              <span>
                <span className="font-medium">Prompt logging</span>
                <span className="block text-xs text-muted-foreground">Prompt、工具参数和输出永不记录</span>
              </span>
              <Badge variant="secondary"><LockKeyhole className="mr-1 size-3" />Locked off</Badge>
            </div>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Theme</span>
              <Select value={theme} onValueChange={(value) => setTheme(value as Settings["theme"])}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="system">System</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <Button className="justify-self-end" disabled={saving} onClick={() => void save()}>
              <Save className="size-4" />{saving ? "保存中…" : "保存设置"}
            </Button>
          </CardContent>
        </Card>
      </div>
      <CodexTakeoverCard />
    </section>
  );
}
