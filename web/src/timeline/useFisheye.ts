'use client'

/** Drives the scrub track's fisheye lens (`fisheye.ts`) off real pointer events and animation
 *  frames. The lens's own math is pure and stateless, split in two: `moveFisheyeLens` reacts to
 *  a pointer move and is applied synchronously, right here in `pointTo` — there is no rAF loop
 *  involved in moving the lens, since it must never move on its own, only in response to the
 *  pointer; `stepFisheyeStrength` is the one time-driven piece (the fade in/out) and runs off a
 *  `requestAnimationFrame` loop, the same split `useAnimatedScale`/`useWheelZoomAccumulator` use
 *  for their own easing. Owns none of the distortion math itself: the caller builds a
 *  `FisheyeScale` from the returned `lens`/`trackWidthPx` via `fisheyeScale`. */

import { useCallback, useEffect, useRef, useState } from 'react'

import { isFisheyeSettled, moveFisheyeLens, RESTING_FISHEYE, stepFisheyeStrength, type FisheyeLens, type FisheyeMotion } from './fisheye'
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
  // The pointer position `motion.lens.centreU` was last moved from — `null` when there is none
  // (at rest, or just released). The next `pointTo` then either reappears the lens under the
  // pointer or moves it there as an ordinary coupled move, depending on whether the lens has
  // actually faded by then (`moveFisheyeLens`'s own doc comment).
  const pointerURef = useRef<number | null>(null)
  const reducedMotionRef = useRef(reducedMotion)
  reducedMotionRef.current = reducedMotion

  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)

  const applyStrengthStep = useCallback((dtSeconds: number): void => {
    const next = stepFisheyeStrength(motionRef.current, pointerURef.current !== null, dtSeconds)
    motionRef.current = next
    setMotion(next)
  }, [])

  const tick = useCallback(
    (now: number) => {
      const dtSeconds = (now - (lastTsRef.current ?? now)) / 1000
      lastTsRef.current = now
      applyStrengthStep(dtSeconds)
      if (isFisheyeSettled(motionRef.current, pointerURef.current !== null)) {
        rafRef.current = null
        lastTsRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [applyStrengthStep],
  )

  // Reduced motion never schedules a frame at all — same idiom as `useAnimatedScale` and
  // `useWheelZoomAccumulator`'s own reduced-motion branch — rather than queuing one rAF just
  // to immediately settle it.
  const ensureLoop = useCallback((): void => {
    if (reducedMotionRef.current) {
      applyStrengthStep(Infinity)
      return
    }
    if (rafRef.current !== null) return
    lastTsRef.current = performance.now()
    rafRef.current = requestAnimationFrame(tick)
  }, [applyStrengthStep, tick])

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  const pointTo = useCallback(
    (u: number, widthPx: number): void => {
      const next = moveFisheyeLens(motionRef.current, pointerURef.current, u, widthPx)
      motionRef.current = next
      setMotion(next)
      pointerURef.current = u
      setTrackWidthPx(widthPx)
      ensureLoop() // strength may still need to fade in, even though the move above was immediate
    },
    [ensureLoop],
  )

  const release = useCallback((): void => {
    pointerURef.current = null
    ensureLoop()
  }, [ensureLoop])

  return { lens: motion.lens, trackWidthPx, pointTo, release }
}
