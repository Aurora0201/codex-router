import { useEffect, useState } from "react"
import { LockKeyhole, Save } from "lucide-react"
import { toast } from "sonner"

import { CodexTakeoverCard } from "@/components/codex/CodexTakeoverCard"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldTitle } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import type {
  CodexStatus,
  GatewayService,
  SettingsState,
  ThemePreference,
} from "@/services/contracts"

const themeItems: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
]

interface SettingsPageProps {
  settings: SettingsState
  codex: CodexStatus
  service: GatewayService
  onSettingsChange(value: SettingsState): void
  onCodexChange(value: CodexStatus): void
  onThemePreview(theme: ThemePreference): void
}

export function SettingsPage({
  settings,
  codex,
  service,
  onSettingsChange,
  onCodexChange,
  onThemePreview,
}: SettingsPageProps) {
  const [metadata, setMetadata] = useState(settings.requestMetadataLogging)
  const [theme, setTheme] = useState(settings.theme)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMetadata(settings.requestMetadataLogging)
    setTheme(settings.theme)
  }, [settings])

  const save = async () => {
    setSaving(true)
    try {
      const next = await service.updateSettings({
        requestMetadataLogging: metadata,
        theme,
      })
      onSettingsChange(next)
      toast.success("设置已保存")
    } catch (reason) {
      toast.error((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const changeTheme = (value: ThemePreference) => {
    setTheme(value)
    onThemePreview(value)
  }

  return (
    <section className="space-y-4">
      <div>
        <p className="text-sm font-medium text-muted-foreground">本地策略</p>
        <h1 className="mt-1 text-2xl font-semibold">设置</h1>
        <p className="mt-1 text-sm text-muted-foreground">所有表单当前保存到内存 Mock，不连接后端。</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Gateway</CardTitle>
            <CardDescription>运行时网络边界</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-muted-foreground">监听地址</dt>
                <dd className="mt-1 font-mono">{settings.gatewayAddress}:{settings.gatewayPort}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">上游</dt>
                <dd className="mt-1 break-all font-mono text-xs">{settings.upstream}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>隐私与外观</CardTitle>
            <CardDescription>敏感数据记录策略与本地主题</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>请求元数据日志</FieldTitle>
                  <FieldDescription>仅状态、耗时、字节数和路由哈希</FieldDescription>
                </FieldContent>
                <Switch
                  checked={metadata}
                  onCheckedChange={setMetadata}
                  aria-label="请求元数据日志"
                />
              </Field>
              <Separator />
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>Prompt 日志</FieldTitle>
                  <FieldDescription>Prompt、工具参数和输出永不记录</FieldDescription>
                </FieldContent>
                <Badge variant="secondary"><LockKeyhole />锁定关闭</Badge>
              </Field>
              <Field>
                <FieldContent>
                  <FieldTitle>主题</FieldTitle>
                  <FieldDescription>跟随系统会实时响应操作系统外观。</FieldDescription>
                </FieldContent>
                <Select
                  items={themeItems}
                  value={theme}
                  onValueChange={(value) => changeTheme(String(value) as ThemePreference)}
                >
                  <SelectTrigger className="w-full" aria-label="主题">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
                    {themeItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button className="self-end" disabled={saving} onClick={() => void save()}>
                <Save />
                {saving ? <><Spinner />保存中</> : "保存设置"}
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

      <CodexTakeoverCard
        status={codex}
        service={service}
        onChange={onCodexChange}
      />
    </section>
  )
}
