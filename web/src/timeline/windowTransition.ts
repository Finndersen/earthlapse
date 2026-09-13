'use client'

/**
 * Eased window changes (README §3: "window changes from buttons, fit, event framing and
 * minimap clicks ease over ~250-350ms in warped space (UI chrome only; t never animates).
 * Wheel and pinch stay immediate"). `t` itself is never touched here — this only animates the
 * *visible window*, which is UI view state, not part of `WorldState`.
 */

import { useCallback, useEffect, useRef } from 'react'

import { unwarpFor, warpFor, type TimeWindow } from './scale'
import { clampUnit, easeInOutCubic } from './util'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

/** Within the 250-350ms the brief asks for. */
export const WINDOW_TRANSITION_MS = 300

/**
 * `from` eased toward `to` at `progress` (0..1), interpolated in `scaleKind`'s warped space so
 * the motion reads as a steady pan/zoom on screen rather than a linear-in-years wipe that
 * would look uneven under symlog. Pure: same inputs, same output.
 */
export function interpolateWindow(from: TimeWindow, to: TimeWindow, progress: number, scaleKind: 'symlog' | 'linear'): TimeWindow {
  const p = clampUnit(progress)
  // Exact at the endpoints (matching blendScales's own k===0/k===1 special case in scale.ts)
  // rather than a warp/unwarp round-trip, which is not bit-exact for a nonlinear warp like
  // symlog.
  if (p === 0) return from
  if (p === 1) return to

  const wFromNewest = warpFor(scaleKind, from[0])
  const wFromOldest = warpFor(scaleKind, from[1])
  const wToNewest = warpFor(scaleKind, to[0])
  const wToOldest = warpFor(scaleKind, to[1])
  const newest = unwarpFor(scaleKind, wFromNewest + (wToNewest - wFromNewest) * p)
  const oldest = unwarpFor(scaleKind, wFromOldest + (wToOldest - wFromOldest) * p)
  return [newest, oldest]
}

interface UseWindowTransitionOptions {
  /** The current window — read via a ref kept fresh every render, so an in-flight animation
   *  always eases *from* wherever the window actually is right now, not a stale snapshot from
   *  when the hook last rendered. */
  window: TimeWindow
  scaleKind: 'symlog' | 'linear'
  onWindowChange: (window: TimeWindow) => void
  durationMs?: number
}

/**
 * Returns `animateWindowTo(target)`: eases `window` to `target` over `durationMs`, calling
 * `onWindowChange` every frame (and exactly once, synchronously, with `target` itself when
 * `prefers-reduced-motion` is set). Call sites that want an immediate jump — wheel, pinch, a
 * live drag — should call `onWindowChange` directly instead of going through this hook at all;
 * this is only for the discrete "chrome" transitions the README lists.
 */
export function useWindowTransition({
  window: currentWindow,
  scaleKind,
  onWindowChange,
  durationMs = WINDOW_TRANSITION_MS,
}: UseWindowTransitionOptions): (target: TimeWindow) => void {
  const reducedMotion = usePrefersReducedMotion()

  const windowRef = useRef(currentWindow)
  windowRef.current = currentWindow
  const scaleKindRef = useRef(scaleKind)
  scaleKindRef.current = scaleKind
  const onWindowChangeRef = useRef(onWindowChange)
  onWindowChangeRef.current = onWindowChange
  const rafRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  return useCallback(
    (target: TimeWindow) => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }

      if (reducedMotion) {
        onWindowChangeRef.current(target)
        return
      }

      const from = windowRef.current
      const kind = scaleKindRef.current
      const startedAt = performance.now()

      const tick = (now: number): void => {
        const progress = Math.min(1, (now - startedAt) / durationMs)
        onWindowChangeRef.current(interpolateWindow(from, target, easeInOutCubic(progress), kind))
        rafRef.current = progress < 1 ? requestAnimationFrame(tick) : null
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [reducedMotion, durationMs],
  )
}
