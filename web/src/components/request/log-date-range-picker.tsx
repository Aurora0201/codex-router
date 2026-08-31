import { useState } from "react"
import { endOfDay, startOfDay } from "date-fns"
import { enUS, zhCN as dateZhCN } from "date-fns/locale"
import { CalendarDaysIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Field } from "@/components/ui/field"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

function rangeFromTimestamps(
  from?: number,
  to?: number
): DateRange | undefined {
  if (from === undefined) return undefined
  return { from: new Date(from), to: new Date(to ?? from) }
}

export function LogDateRangePicker({
  from,
  to,
  onApply,
  onClear,
}: {
  from?: number
  to?: number
  onApply(from: number, to: number): void
  onClear(): void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? "zh-CN"
  const calendarLocale = locale.startsWith("en") ? enUS : dateZhCN
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<DateRange | undefined>(() =>
    rangeFromTimestamps(from, to)
  )

  const formatDate = (date: Date) => date.toLocaleDateString(locale)
  const selectedFrom = draft?.from
  const selectedTo = draft?.to ?? draft?.from
  const label =
    from === undefined
      ? t("选择日期范围")
      : `${formatDate(new Date(from))} — ${formatDate(new Date(to ?? from))}`

  return (
    <Field className="sm:col-span-2">
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (nextOpen) setDraft(rangeFromTimestamps(from, to))
          setOpen(nextOpen)
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              className="w-full justify-start font-normal"
            />
          }
          aria-label={t("日期范围")}
        >
          <CalendarDaysIcon data-icon="inline-start" />
          <span className="truncate">{label}</span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="range"
            selected={draft}
            onSelect={setDraft}
            defaultMonth={draft?.from}
            captionLayout="dropdown"
            locale={calendarLocale}
            timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
          />
          <div className="flex items-center justify-between gap-2 border-t border-border p-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(undefined)
                onClear()
                setOpen(false)
              }}
            >
              {t("清除日期")}
            </Button>
            <Button
              size="sm"
              disabled={!selectedFrom}
              onClick={() => {
                if (!selectedFrom || !selectedTo) return
                onApply(
                  startOfDay(selectedFrom).getTime(),
                  endOfDay(selectedTo).getTime()
                )
                setOpen(false)
              }}
            >
              {t("保存")}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </Field>
  )
}
