import type { RequestLogRange, RequestLogsResponse } from "@/services/contracts"

type Bucket = RequestLogsResponse["histogram"][number]

const BUCKET_MS: Record<RequestLogRange, number> = {
  "1h": 60_000,
  "24h": 15 * 60_000,
  "7d": 2 * 60 * 60_000,
}

export function normalizeRequestHistogram(
  range: RequestLogRange,
  from: number,
  to: number,
  histogram: Bucket[]
): Bucket[] {
  const bucketMs = BUCKET_MS[range]
  const bucketCount = Math.max(1, Math.ceil((to - from) / bucketMs))
  const byStartedAt = new Map(
    histogram.map((bucket) => [bucket.startedAt, bucket])
  )

  return Array.from({ length: bucketCount }, (_unused, index) => {
    const startedAt = from + index * bucketMs
    return (
      byStartedAt.get(startedAt) ?? {
        startedAt,
        endedAt: Math.min(to, startedAt + bucketMs),
        requests: 0,
        errors: 0,
        rejected: 0,
        cancelled: 0,
      }
    )
  })
}
