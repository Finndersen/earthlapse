'use client'

/**
 * Throttles rapid updates to `value` down to at most one committed change per `intervalMs`, but
 * always lands on the true latest value once updates stop — a "coalescing" throttle, not a
 * "drop the tail" one. `Experience.tsx` writes a fresh `t` to the time store on every playback
 * animation frame, so any component that renders straight from `t` redoes its work 60 times a
 * second even though a HUD readout's numeric text or sparkline trace reads the same to a viewer
 * at 10-15fps. Pass `t` through this hook and use the returned value for rendering instead.
 *
 * The first change after a quiet period (nothing committed for at least `intervalMs`) is shown
 * immediately rather than waiting out a fresh window. In practice this is what makes a scrub or
 * a jump feel instant: by the time a viewer grabs the scrubber, `t` has almost always been
 * sitting still for longer than `intervalMs`, so the scrub's first value is the "first change
 * after quiet" and commits straight away. Only a value already changing every frame — playback —
 * gets held back, which is exactly the case this hook exists to throttle.
 *
 * Pure and deterministic given its inputs in the sense that matters here: it never depends on
 * wall-clock time for anything except measuring elapsed time against `intervalMs` itself (the
 * one thing a throttle cannot avoid reading), and it never drops or reorders values — the
 * committed value is always either the current `value` or an earlier one still waiting out its
 * window, never a skipped one.
 */

import { useEffect, useRef, useState } from 'react'

/** ~12fps. Comfortably inside the "10-15fps is indistinguishable from 60fps for a HUD readout"
 *  budget the perf brief sets, while staying well under the ~150ms where a change starts to read
 *  as sluggish rather than smooth. */
export const HUD_READOUT_THROTTLE_MS = 80

export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [committed, setCommitted] = useState(value)
  const lastCommitAtRef = useRef(Date.now())
  const pendingValueRef = useRef(value)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Always the freshest value, whether or not this render's effect below ends up using it —
  // a trailing timeout scheduled by an earlier render reads it via the ref when it fires, so a
  // burst of values arriving before that timeout fires still settles on the last of them.
  pendingValueRef.current = value

  useEffect(() => {
    if (value === committed) return

    const commitNow = (): void => {
      lastCommitAtRef.current = Date.now()
      setCommitted(pendingValueRef.current)
    }

    const elapsedSinceCommit = Date.now() - lastCommitAtRef.current
    if (elapsedSinceCommit >= intervalMs) {
      commitNow()
      return
    }

    // A trailing commit is already scheduled; it will pick up `pendingValueRef.current` — the
    // latest value — whenever it fires, so there is nothing to do here but wait for it.
    if (timeoutRef.current !== null) return

    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null
      commitNow()
    }, intervalMs - elapsedSinceCommit)
  }, [value, committed, intervalMs])

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    },
    [],
  )

  return committed
}
