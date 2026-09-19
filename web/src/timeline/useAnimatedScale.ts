'use client'

/** The timeline's animated scale: the symlog<->linear toggle (DESIGN §3: "Animating symlog ->
 *  linear collapses all of human history to sub-pixel width. It is the most effective
 *  educational moment available... Build it early.") and the window change when a section is
 *  selected (ADR-024). */

import { useEffect, useMemo, useRef, useState } from 'react'

import type { GeoTime, TimeScale } from '@/types/layer'

import { blendScales, createLinearScale, createSymlogScale, interpolateWindow, type TimeWindow } from './scale'
import { easeInOutCubic } from './util'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

/** ~1.2s per the spec, eased so the collapse reads as a deliberate motion rather than a
 *  linear wipe. */
const SCALE_KIND_ANIMATION_MS = 1200

/** A section change is navigation, not a lesson like the linear collapse, so it runs quicker.
 *  It still has to be long enough to show which way the window moved. */
const WINDOW_ANIMATION_MS = 700

/** `target`, eased in symlog-warped space (`interpolateWindow`) from wherever the window was
 *  when `target` last changed. When it settles, it returns `target`'s own reference, so
 *  memoised scales stay stable. */
function useAnimatedWindow(target: TimeWindow, reducedMotion: boolean): TimeWindow {
  const [shown, setShown] = useState<TimeWindow>(target)
  const shownRef = useRef(shown)
  shownRef.current = shown
  const targetRef = useRef(target)
  targetRef.current = target
  const [newest, oldest] = target

  useEffect(() => {
    const from = shownRef.current
    const to = targetRef.current
    if (from[0] === to[0] && from[1] === to[1]) return
    if (reducedMotion) {
      setShown(to)
      return
    }

    const startedAt = performance.now()
    let rafId: number
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / WINDOW_ANIMATION_MS)
      setShown(progress < 1 ? interpolateWindow(from, to, easeInOutCubic(progress)) : to)
      if (progress < 1) rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [newest, oldest, reducedMotion])

  return shown
}

/**
 * Returns a `TimeScale` over `window` that is `createSymlogScale` when at rest on `'symlog'`
 * and `createLinearScale` when at rest on `'linear'`. It interpolates between the two (via
 * `blendScales`) over `SCALE_KIND_ANIMATION_MS` whenever `targetKind` changes, and moves its
 * domain over `WINDOW_ANIMATION_MS` whenever `window` changes. Either animation re-renders the
 * owning component on every frame.
 *
 * At rest, two renders with an unchanged `window` (by value) and kind return the *same* object.
 * The caller (Experience.tsx) owns this hook and passes the one scale down to `<Timeline>` and
 * to anything else drawn on the same axis (the chart dock), rather than `<Timeline>` computing
 * it and reporting it back up.
 *
 * `knee` overrides the symlog scale's own knee (re-review fix, 2026-09-15) — omit it to fall
 * back to `createSymlogScale`'s own `symlogKnee(window)` default. The caller passes
 * `sectionSymlogKnee(sectionId)` so a leaf section's own display doesn't inherit the adaptive
 * knee meant for a section with children (see that function's doc comment). Held fixed for the
 * whole of a section-change animation rather than recomputed per intermediate frame of
 * `shownWindow`, the same way `interpolateWindow`'s own transition shape is deliberately
 * decoupled from the resting scale's knee (`scale.ts`'s own doc comment) — a knee that changed
 * mid-transition would have no principled per-frame value to take anyway, since the animated
 * window belongs to no single section until it settles.
 */
export function useAnimatedScale(window: TimeWindow, targetKind: 'symlog' | 'linear', knee?: GeoTime): TimeScale {
  const targetK = targetKind === 'linear' ? 1 : 0
  const [k, setK] = useState(targetK)
  const reducedMotion = usePrefersReducedMotion()
  const shownWindow = useAnimatedWindow(window, reducedMotion)

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
      const progress = Math.min(1, (now - startedAt) / SCALE_KIND_ANIMATION_MS)
      setK(from + (targetK - from) * easeInOutCubic(progress))
      rafRef.current = progress < 1 ? requestAnimationFrame(tick) : null
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
    // Re-runs only when the target (or the reduced-motion preference) changes. `k`'s own
    // updates are read via `kRef`, so the running animation isn't restarted every frame by its
    // own `setK` calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetK, reducedMotion])

  const symlog = useMemo(() => createSymlogScale(shownWindow, knee), [shownWindow, knee])
  const linear = useMemo(() => createLinearScale(shownWindow), [shownWindow])
  return useMemo(() => blendScales(symlog, linear, k), [symlog, linear, k])
}
