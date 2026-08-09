import { FlaskConical } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MockScenario } from "@/services/contracts"

const labels: Record<MockScenario, string> = {
  healthy: "正常运行",
  empty: "无账号",
  "no-active": "未选择账号",
  degraded: "部分失败",
  offline: "Gateway 离线",
}

const scenarioItems = Object.entries(labels).map(([value, label]) => ({
  value,
  label,
}))

export function MockToolbar({
  scenario,
  onChange,
}: {
  scenario: MockScenario
  onChange(value: MockScenario): void
}) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <FlaskConical />Mock<Badge variant="secondary">{labels[scenario]}</Badge>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="end" className="w-72">
        <div className="space-y-3">
          <div>
            <p className="font-medium">Mock 场景</p>
            <p className="text-xs text-muted-foreground">只改变内存数据，不连接后端。</p>
          </div>
          <Select
            items={scenarioItems}
            value={scenario}
            onValueChange={(value) => onChange(String(value) as MockScenario)}
          >
            <SelectTrigger className="w-full" aria-label="Mock 场景">
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
              {scenarioItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  )
}
