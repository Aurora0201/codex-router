import { useState } from "react"
import { format } from "date-fns"
import { CalendarDaysIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { nextBillingAt } from "@/lib/billing-cycle"
import { formatBillingCountdown, formatDateOnly } from "@/lib/format"
import type { AccountView, BillingCadence } from "@/services/contracts"

function fromTimestamp(value: number | null): Date | undefined {
  if (value === null) return undefined
  const date = new Date(value)
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function toTimestamp(value: Date): number {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate())
}

export function BillingDialog({
  account,
  busy,
  onOpenChange,
  onSave,
}: {
  account: AccountView
  busy: boolean
  onOpenChange(open: boolean): void
  onSave(value: {
    billingAnchorAt: number | null
    billingCadence: BillingCadence | null
  }): void
}) {
  const { t } = useTranslation()
  const [date, setDate] = useState<Date | undefined>(() =>
    fromTimestamp(account.billing.anchorAt)
  )
  const [cadence, setCadence] = useState<BillingCadence>(
    account.billing.cadence ?? "monthly"
  )
  const [pickerOpen, setPickerOpen] = useState(false)
  const [now] = useState(Date.now)
  const nextBilling = nextBillingAt(
    date ? toTimestamp(date) : null,
    cadence,
    now
  )

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("设置自动续订周期")}</DialogTitle>
          <DialogDescription>
            {t("填写最近一次实际付款日期，系统会自动推算下一次续订时间。")}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>{t("最近付款日")}</FieldLabel>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant="outline"
                    data-empty={!date}
                    className="justify-start text-left font-normal data-[empty=true]:text-muted-foreground"
                  />
                }
              >
                <CalendarDaysIcon />
                {date ? format(date, "yyyy-MM-dd") : t("选择日期")}
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={date}
                  disabled={{ after: new Date() }}
                  onSelect={(value) => {
                    setDate(value)
                    if (value) setPickerOpen(false)
                  }}
                  captionLayout="dropdown"
                />
              </PopoverContent>
            </Popover>
            <FieldDescription>
              {t("只能选择今天或过去的实际付款日期。")}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{t("付款周期")}</FieldLabel>
            <ToggleGroup
              className="w-full"
              variant="outline"
              value={[cadence]}
              onValueChange={(values) => {
                const value = values[0]
                if (value === "monthly" || value === "annual") setCadence(value)
              }}
            >
              <ToggleGroupItem className="flex-1" value="monthly">
                {t("每月")}
              </ToggleGroupItem>
              <ToggleGroupItem className="flex-1" value="annual">
                {t("每年")}
              </ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>
              {nextBilling === null
                ? t("选择付款日期后将显示下一次自动续订时间。")
                : t("下次自动续订：{{date}} · {{countdown}}", {
                    date: formatDateOnly(nextBilling),
                    countdown: formatBillingCountdown(nextBilling, now),
                  })}
            </FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          {account.billing.anchorAt !== null ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                onSave({ billingAnchorAt: null, billingCadence: null })
              }
            >
              {t("清除付款设置")}
            </Button>
          ) : null}
          <DialogClose render={<Button variant="outline" disabled={busy} />}>
            {t("取消")}
          </DialogClose>
          <Button
            disabled={!date || busy}
            onClick={() =>
              date &&
              onSave({
                billingAnchorAt: toTimestamp(date),
                billingCadence: cadence,
              })
            }
          >
            {t("保存")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
