import { CircleUserRound } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { shortAccountId } from "@/lib/format"
import type { Account } from "@/services/contracts"

interface ActiveAccountSelectProps {
  accounts: Account[]
  activeAccountId: string | null
  disabled?: boolean
  onSelect(accountId: string): void
}

export function ActiveAccountSelect({
  accounts,
  activeAccountId,
  disabled = false,
  onSelect,
}: ActiveAccountSelectProps) {
  const availableAccounts = accounts.filter(
    (account) => account.enabled && account.authStatus === "ready",
  )
  const items = availableAccounts.map((account) => ({
    value: account.id,
    label: `${shortAccountId(account.chatgptAccountId)} · ${account.planType ?? "Unknown plan"}`,
  }))

  return (
    <Select
      items={items}
      value={activeAccountId}
      onValueChange={(value) => value && onSelect(String(value))}
      disabled={disabled || availableAccounts.length === 0}
    >
      <SelectTrigger className="w-full sm:max-w-md" aria-label="选择当前账号">
        <CircleUserRound className="text-muted-foreground" />
        <SelectValue placeholder={availableAccounts.length === 0 ? "没有可用账号" : "请选择当前账号"} />
      </SelectTrigger>
      <SelectContent side="bottom" align="start" alignItemWithTrigger={false}>
        <SelectGroup>
          <SelectLabel>可用于下一次请求的账号</SelectLabel>
          {availableAccounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              <span className="font-mono text-xs">{shortAccountId(account.chatgptAccountId)}</span>
              <span className="text-muted-foreground">· {account.planType ?? "Unknown plan"}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
