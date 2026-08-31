import { useEffect, useRef, useState } from "react"

/**
 * How long a load may run before it is worth saying anything about it. The
 * gateway is on the same machine, so a range switch is usually answered well
 * inside this. Nobody has started reading half a second after their own click,
 * so there is nothing yet to correct — and a treatment that comes and goes
 * that fast reads as a flicker rather than as an explanation.
 */
const GRACE_MS = 500

/**
 * Once the treatment is up, how long it stays. A load that finishes just past
 * the grace period would otherwise show a few frames of it and take it away
 * again, which is the same flicker arriving late.
 */
const MIN_VISIBLE_MS = 400

/**
 * Reports whether a load has gone on long enough to be worth showing. Fast
 * loads never register, so the content simply updates in place.
 */
export function useSlowLoad(pending: boolean) {
  const [slow, setSlow] = useState(false)
  const shownAt = useRef(0)

  useEffect(() => {
    if (pending) {
      if (slow) return
      const timer = window.setTimeout(() => {
        shownAt.current = performance.now()
        setSlow(true)
      }, GRACE_MS)
      return () => window.clearTimeout(timer)
    }
    if (!slow) return
    const shown = performance.now() - shownAt.current
    const timer = window.setTimeout(
      () => setSlow(false),
      Math.max(0, MIN_VISIBLE_MS - shown)
    )
    return () => window.clearTimeout(timer)
  }, [pending, slow])

  return slow
}
