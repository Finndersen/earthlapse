'use client'

/** Drives the scrub track's fisheye lens (`fisheye.ts`) off real animation frames — the lens's
 *  own easing (`stepFisheye`) is pure and stateless, this hook is just the `requestAnimationFrame`
 *  loop and React state around it, the same split `useAnimatedScale`/`useWheelZoomAccumulator`
 *  use for their own easing. Owns none of the distortion math itself: the caller builds a
 *  `FisheyeScale` from the returned `lens`/`trackWidthPx` via `fisheyeScale`. */

import { useCallback, useEffect, useRef, useState } from 'react'

import { isFisheyeSettled, RESTING_FISHEYE, stepFisheye, type FisheyeLens, type FisheyeMotion } from './fisheye'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

export interface UseFisheyeResult {
  lens: FisheyeLens
  /** The track width `lens` was last computed against — 0 (no distortion) until the first
   *  `pointTo`. Threaded back out because `fisheyeScale` needs it and only the caller measures
   *  the track's real pixel width. */
  trackWidthPx: number
  /** Point the lens at displayed track unit `u` on a `trackWidthPx`-wide track — call from
   *  every pointer move/down the track wants the lens to react to. */
  pointTo: (u: number, trackWidthPx: number) => void
  /** Let the lens fade back to rest, e.g. the pointer leaving the track. */
  release: () => void
}

export function useFisheye(): UseFisheyeResult {
  const [motion, setMotion] = useState<FisheyeMotion>(RESTING_FISHEYE)
  const [trackWidthPx, setTrackWidthPx] = useState(0)
  const reducedMotion = usePrefersReducedMotion()

  const motionRef = useRef(motion)
  motionRef.current = motion
  const trackWidthPxRef = useRef(trackWidthPx)
  trackWidthPxRef.current = trackWidthPx
  const pointerURef = useRef<number | null>(null)
  const reducedMotionRef = useRef(reducedMotion)
  reducedMotionRef.current = reducedMotion

  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)

  const applyStep = useCallback((dtSeconds: number): void => {
    const next = stepFisheye(motionRef.current, pointerURef.current, trackWidthPxRef.current, dtSeconds)
    motionRef.current = next
    setMotion(next)
  }, [])

  const tick = useCallback(
    (now: number) => {
      const dtSeconds = (now - (lastTsRef.current ?? now)) / 1000
      lastTsRef.current = now
      applyStep(dtSeconds)
      if (isFisheyeSettled(motionRef.current, pointerURef.current)) {
        rafRef.current = null
        lastTsRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [applyStep],
  )

  // Reduced motion never schedules a frame at all — same idiom as `useAnimatedScale` and
  // `useWheelZoomAccumulator`'s own reduced-motion branch — rather than queuing one rAF just
  // to immediately settle it.
  const ensureLoop = useCallback((): void => {
    if (reducedMotionRef.current) {
      applyStep(Infinity)
      return
    }
    if (rafRef.current !== null) return
    lastTsRef.current = performance.now()
    rafRef.current = requestAnimationFrame(tick)
  }, [applyStep, tick])

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const pointTo = useCallback(
    (u: number, widthPx: number): void => {
      pointerURef.current = u
      trackWidthPxRef.current = widthPx
      setTrackWidthPx(widthPx)
      ensureLoop()
    },
    [ensureLoop],
  )

  const release = useCallback((): void => {
    pointerURef.current = null
    ensureLoop()
  }, [ensureLoop])

  return { lens: motion.lens, trackWidthPx, pointTo, release }
}
