'use client'

/** The symlog<->linear toggle animation (DESIGN §3: "Animating symlog -> linear collapses
 *  all of human history to sub-pixel width. It is the most effective educational moment
 *  available... Build it early."). */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { TimeScale } from '@/types/layer'

import { blendScales, createLinearScale, createSymlogScale, type TimeWindow } from './scale'
import { easeInOutCubic } from './util'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

/** ~1.2s per the spec, eased so the collapse reads as a deliberate motion rather than a
 *  linear wipe. */
const ANIMATION_DURATION_MS = 1200

/**
 * Returns a `TimeScale` over `window` that is `createSymlogScale` when at rest on
 * `'symlog'`, `createLinearScale` when at rest on `'linear'`, and smoothly interpolates
 * between them (via `blendScales`) over `ANIMATION_DURATION_MS` whenever `targetKind`
 * changes. Re-renders the owning component on every animation frame.
 *
 * The returned `TimeScale` is memoised on `[window, k]` (W12a) so that two renders with an
 * unchanged `window` and an at-rest `k` return the *same* object — not just an equal one.
 * `Timeline` relies on this to expose its live scale via `onScaleChange` without that
 * exposure looping: a consumer that stores the callback's argument in state and passes an
 * unchanged `window`/`scaleKind` back down sees a referentially stable scale and therefore
 * does not re-trigger the effect that reported it.
 */
export function useAnimatedScale(window: TimeWindow, targetKind: 'symlog' | 'linear'): TimeScale {
  const targetK = targetKind === 'linear' ? 1 : 0
  const [k, setK] = useState(targetK)
  const reducedMotion = usePrefersReducedMotion()

  const kRef = useRef(k)
  kRef.current = k
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (kRef.current === targetK) return
    if (reducedMotion) {
      setK(targetK)
      return
    }

    const from = kRef.current
    const startedAt = performance.now()

    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / ANIMATION_DURATION_MS)
      setK(from + (targetK - from) * easeInOutCubic(progress))
      rafRef.current = progress < 1 ? requestAnimationFrame(tick) : null
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
    // Re-runs only when the target (or the reduced-motion preference) changes; `k`'s own
    // updates are read via `kRef` so the in-flight animation isn't restarted every frame by
    // its own `setK` calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetK, reducedMotion])

  const symlog = useMemo(() => createSymlogScale(window), [window])
  const linear = useMemo(() => createLinearScale(window), [window])
  return useMemo(() => blendScales(symlog, linear, k), [symlog, linear, k])
}
