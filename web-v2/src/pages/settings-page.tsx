import { useState } from "react"
import {
  Clock3Icon,
  LockKeyholeIcon,
  NetworkIcon,
  SaveIcon,
  Settings2Icon,
} from "lucide-react"

import { CodexTakeoverCard } from "@/components/codex/codex-takeover-card"
import { useTheme } from "@/components/theme-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import type {
  GatewayService,
  GatewaySnapshot,
  SettingsView,
} from "@/services/contracts"

const themeItems: { value: SettingsView["theme"]; label: string }[] = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
]

export function SettingsPage({
  snapshot,
  service,
  reload,
}: {
  snapshot: GatewaySnapshot
  service: GatewayService
  reload(): Promise<void>
}) {
  const [metadata, setMetadata] = useState(
    snapshot.settings.requestMetadataLogging
  )
  const [theme, setTheme] = useState(snapshot.settings.theme)
  const [saving, setSaving] = useState(false)
  const themeContext = useTheme()

  const changeTheme = (value: SettingsView["theme"] | null) => {
    if (!value) return
    setTheme(value)
    themeContext.setTheme(value)
  }

  const save = async () => {
    setSaving(true)
    try {
      await service.saveSettings({ requestMetadataLogging: metadata, theme })
      await reload()
      toast.add({ title: "设置已保存", type: "success" })
    } catch (error) {
      toast.add({
        title: "保存失败",
        description: (error as Error).message,
        type: "error",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <Badge variant="outline" className="w-fit">
          <Settings2Icon />
          Configuration
        </Badge>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Gateway 设置
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理 Codex 接管、固定网络边界与允许持久化的本地偏好。
          </p>
        </div>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(21rem,1fr)]">
        <CodexTakeoverCard
          status={snapshot.codex}
          service={service}
          reload={reload}
        />
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>网络边界</CardTitle>
              <CardDescription>
                由 Gateway 启动配置决定，前端仅做只读展示。
              </CardDescription>
              <CardAction>
                <Badge variant="secondary">只读</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-start gap-3 rounded-lg bg-muted/60 p-3">
                <NetworkIcon className="mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">监听地址</p>
                  <p className="mt-1 truncate font-mono text-xs font-medium">
                    {snapshot.settings.gatewayAddress}:
                    {snapshot.settings.gatewayPort}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg bg-muted/60 p-3">
                <NetworkIcon className="mt-0.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Codex 上游</p>
                  <p className="mt-1 font-mono text-xs break-all">
                    {snapshot.settings.upstream}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-lg bg-muted/60 p-3">
                <Clock3Icon className="mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">运行时长</p>
                  <p className="mt-1 font-mono text-xs font-medium">
                    {Math.floor(snapshot.stats.uptimeSeconds / 3600)} 小时
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>隐私与外观</CardTitle>
              <CardDescription>
                敏感内容记录始终关闭，无法从界面启用。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Request metadata logging</FieldTitle>
                    <FieldDescription>
                      仅记录状态、耗时、字节数和路由哈希。
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    checked={metadata}
                    onCheckedChange={setMetadata}
                    aria-label="Request metadata logging"
                  />
                </Field>
                <Field orientation="horizontal" data-disabled>
                  <FieldContent>
                    <FieldTitle>Prompt logging</FieldTitle>
                    <FieldDescription>
                      Prompt、工具参数、工具输出和响应体永不记录。
                    </FieldDescription>
                  </FieldContent>
                  <Badge variant="secondary">
                    <LockKeyholeIcon />
                    锁定关闭
                  </Badge>
                </Field>
                <Field orientation="responsive">
                  <FieldContent>
                    <FieldTitle>主题</FieldTitle>
                    <FieldDescription>选择后立即预览。</FieldDescription>
                  </FieldContent>
                  <Select
                    items={themeItems}
                    value={theme}
                    onValueChange={changeTheme}
                  >
                    <SelectTrigger className="w-full sm:w-36" aria-label="主题">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      side="bottom"
                      align="end"
                      alignItemWithTrigger={false}
                    >
                      <SelectGroup>
                        {themeItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="justify-end">
              <Button disabled={saving} onClick={() => void save()}>
                {saving ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <SaveIcon data-icon="inline-start" />
                )}
                {saving ? "保存中" : "保存设置"}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </section>
  )
}
