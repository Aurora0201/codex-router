import { useState } from "react";
import { LockKeyhole, Save } from "lucide-react";
import { api, type Account, type Settings } from "../lib/api";
import { Badge, Button, Card } from "../components/ui";

export function SettingsPage({ settings, accounts, reload }: { settings: Settings; accounts: Account[]; reload(): Promise<void> }) {
  const [metadata, setMetadata] = useState(settings.requestMetadataLogging);
  const [theme, setTheme] = useState(settings.theme);
  const [saving, setSaving] = useState(false);
  const save = async () => { setSaving(true); try { await api.updateSettings({ requestMetadataLogging: metadata, theme }); document.documentElement.dataset.theme = theme === "system" ? "" : theme; await reload(); } finally { setSaving(false); } };
  return <section className="space-y-4"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-primary">Local policy</p><h1 className="mt-1 text-2xl font-semibold">Settings</h1><p className="mt-1 text-sm text-muted-foreground">网络边界和上游地址在运行时锁定，避免认证被发送到非预期目标。</p></div>
    <div className="grid gap-4 lg:grid-cols-2"><Card><h2 className="font-semibold">Gateway</h2><dl className="mt-4 grid gap-4 text-sm"><div><dt className="text-muted-foreground">Address</dt><dd className="mt-1 font-mono">{settings.gatewayAddress}:{settings.gatewayPort}</dd></div><div><dt className="text-muted-foreground">Upstream</dt><dd className="mt-1 break-all font-mono text-xs">{settings.upstream}</dd></div><div><dt className="text-muted-foreground">Default account</dt><dd className="mt-1">{accounts.find((item) => item.isDefault)?.label ?? "None"}</dd></div></dl></Card>
      <Card><h2 className="font-semibold">Privacy</h2><div className="mt-4 grid gap-4"><label className="flex items-center justify-between gap-4 text-sm"><span><span className="font-medium">Request metadata logging</span><span className="block text-xs text-muted-foreground">仅状态、耗时、字节数和路由哈希</span></span><input type="checkbox" checked={metadata} onChange={(event) => setMetadata(event.target.checked)} className="size-4 accent-[var(--primary)]" /></label><div className="flex items-center justify-between gap-4 text-sm"><span><span className="font-medium">Prompt logging</span><span className="block text-xs text-muted-foreground">Prompt、工具参数和输出永不记录</span></span><Badge tone="good"><LockKeyhole size={12} className="mr-1" />Locked off</Badge></div><label className="grid gap-2 text-sm"><span className="font-medium">Theme</span><select value={theme} onChange={(event) => setTheme(event.target.value as Settings["theme"])} className="rounded-md border bg-background px-3 py-2"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><Button className="justify-self-end" disabled={saving} onClick={() => void save()}><Save size={15} />{saving ? "保存中…" : "保存设置"}</Button></div></Card></div>
  </section>;
}
