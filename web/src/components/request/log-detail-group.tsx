export function LogDetailGroup({
  title,
  values,
}: {
  title: string
  values: (string | number)[][]
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-muted p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <dl className="flex flex-col gap-3 text-sm">
        {values.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-muted-foreground">{label}</dt>
            <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere] break-words tabular-nums">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
