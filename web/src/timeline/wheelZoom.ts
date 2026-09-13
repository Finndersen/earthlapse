'use client'

/**
 * Smooths wheel/pinch zoom input on the scrub track into one continuous eased motion instead
 * of a visible jump per wheel event (README/brief: "eased and accumulated (no jumpy steps)").
 * Pan (horizontal wheel / shift+wheel) is deliberately NOT smoothed here — it stays immediate,
 * "content moves 1:1 with the gesture" — only zoom goes through this.
 *
 * The *target* window updates instantly and synchronously on every wheel event (via
 * `zoomWindow`, chained onto the previous target — not the currently-applied window — so a
 * burst of notches compounds correctly instead of each one restarting from a stale position); a
 * `requestAnimationFrame` loop eases the *applied* (reported) window toward that target one
 * frame at a time. `smoothWindowStep` is that per-frame step, pure and directly testable:
 * exponential smoothing in `scaleKind`'s warped space via `interpolateWindow`, so it reads as
 * the same instrument as every other eased motion in this package.
 */

import { useCallback, useEffect, useRef } from 'react'

import { warpFor, type TimeWindow } from './scale'
import { interpolateWindow } from './windowTransition'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import { zoomWindow } from './zoom'

/** Time constant, ms, for the exponential smoothing: `alpha = 1 - exp(-dtMs / this)`. Tuned so
 *  a single, isolated mouse-wheel notch still reads as a small deliberate ease rather than
 *  either a hard step (too small) or a sluggish drift (too large). */
export const WHEEL_ZOOM_SMOOTHING_MS = 90

/** How close `current` must be to `target` (in each edge's warped-space unit) before the
 *  smoothing loop can stop — otherwise it spins `requestAnimationFrame` forever chasing a
 *  target that exponential smoothing only ever approaches, never exactly reaches. */
export const WHEEL_ZOOM_SETTLE_EPSILON = 1e-4

/**
 * One frame's step of `current` toward `target`, `dtMs` after the last step, via exponential
 * smoothing in `scaleKind`'s warped space (`interpolateWindow` with `alpha` as the progress).
 * Pure. Non-positive `dtMs`/`smoothingMs` snaps straight to `target` (no meaningful smoothing
 * to do — guards the first frame, where there is no previous timestamp to take a `dt` from).
 */
export function smoothWindowStep(
  current: TimeWindow,
  target: TimeWindow,
  dtMs: number,
  scaleKind: 'symlog' | 'linear',
  smoothingMs: number = WHEEL_ZOOM_SMOOTHING_MS,
): TimeWindow {
  if (!(smoothingMs > 0) || !(dtMs > 0)) return target
  const alpha = 1 - Math.exp(-dtMs / smoothingMs)
  return interpolateWindow(current, target, alpha, scaleKind)
}

/** Whether `a` and `b` are close enough, in `scaleKind`'s warped space, that the smoothing loop
 *  can stop stepping toward `b` and consider itself settled at it. */
export function windowsNearlyEqual(
  a: TimeWindow,
  b: TimeWindow,
  scaleKind: 'symlog' | 'linear',
  eps: number = WHEEL_ZOOM_SETTLE_EPSILON,
): boolean {
  return Math.abs(warpFor(scaleKind, a[0]) - warpFor(scaleKind, b[0])) < eps && Math.abs(warpFor(scaleKind, a[1]) - warpFor(scaleKind, b[1])) < eps
}

interface UseWheelZoomAccumulatorOptions {
  /** The current, externally-owned window — read via a ref kept fresh every render (same
   *  pattern as `useWindowTransition`), so a fresh gesture that starts while idle always
   *  targets from wherever the window actually is right now (which may have moved for reasons
   *  outside this hook, e.g. a pan or the fit-all button), not a stale snapshot. */
  window: TimeWindow
  scaleKind: 'symlog' | 'linear'
  onWindowChange: (window: TimeWindow) => void
}

/**
 * Returns `applyWheelZoom(anchorU, factor)` — call it from a wheel/pinch handler in place of
 * calling `zoomWindow` + `onWindowChange` directly. Each call zooms the *target* by `factor`
 * around `anchorU` (same contract as `zoomWindow`); a `requestAnimationFrame` loop eases the
 * reported window toward that target. Snaps straight to the target with no easing when
 * `prefers-reduced-motion` is set, matching every other animation in this package.
 */
export function useWheelZoomAccumulator({ window: currentWindow, scaleKind, onWindowChange }: UseWheelZoomAccumulatorOptions): (
  anchorU: number,
  factor: number,
) => void {
  const reducedMotion = usePrefersReducedMotion()

  const windowRef = useRef(currentWindow)
  windowRef.current = currentWindow
  const scaleKindRef = useRef(scaleKind)
  scaleKindRef.current = scaleKind
  const onWindowChangeRef = useRef(onWindowChange)
  onWindowChangeRef.current = onWindowChange

  const targetRef = useRef(currentWindow)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const tick = useCallback((now: number) => {
    const kind = scaleKindRef.current
    const dtMs = lastTsRef.current === null ? 0 : now - lastTsRef.current
    lastTsRef.current = now
    const next = smoothWindowStep(windowRef.current, targetRef.current, dtMs, kind)
    onWindowChangeRef.current(next)
    if (windowsNearlyEqual(next, targetRef.current, kind)) {
      rafRef.current = null
      lastTsRef.current = null
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  return useCallback(
    (anchorU: number, factor: number) => {
      // Chain onto the in-flight target (not the currently-applied window) while a smoothing
      // pass is already running, so a burst of rapid notches compounds; otherwise start fresh
      // from wherever the window actually is now.
      const from = rafRef.current === null ? windowRef.current : targetRef.current
      targetRef.current = zoomWindow(from, anchorU, factor, scaleKindRef.current)

      if (reducedMotion) {
        onWindowChangeRef.current(targetRef.current)
        return
      }
      if (rafRef.current === null) {
        lastTsRef.current = null
        rafRef.current = requestAnimationFrame(tick)
      }
    },
    [reducedMotion, tick],
  )
}
