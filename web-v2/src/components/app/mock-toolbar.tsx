import { FlaskConicalIcon } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { MockScenario } from "@/services/contracts"

const scenarios: { value: MockScenario; label: string }[] = [
  { value: "healthy", label: "正常" },
  { value: "empty", label: "空账号" },
  { value: "no-active", label: "未选择账号" },
  { value: "degraded", label: "服务降级" },
  { value: "offline", label: "Gateway 离线" },
]

export function MockToolbar({
  value,
  onValueChange,
}: {
  value: MockScenario
  onValueChange(value: MockScenario): void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground [&_svg]:size-3.5">
        <FlaskConicalIcon aria-hidden="true" />
        Mock
      </span>
      <Select
        items={scenarios}
        value={value}
        onValueChange={(next) => {
          if (next) onValueChange(next)
        }}
      >
        <SelectTrigger size="sm" aria-label="Mock 场景">
          <SelectValue />
        </SelectTrigger>
        <SelectContent side="bottom" align="end" alignItemWithTrigger={false}>
          <SelectGroup>
            {scenarios.map((scenario) => (
              <SelectItem key={scenario.value} value={scenario.value}>
                {scenario.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
