'use client'

/** Playback (DESIGN §3): "the playhead moves at constant velocity in warped screen space...
 *  Speed control is a scalar multiplier on that velocity; nothing else changes." */

import { useEffect, useRef } from 'react'

import type { GeoTime, Playback, TimeScale } from '@/types/layer'

import { clampUnit } from './util'

/**
 * Advances `t` by one frame of playback. Moves at constant velocity in the warped `u` of
 * `fullScale` — always the *full-domain* scale, never the current visible window's, so
 * playback speed does not change when the user zooms — toward the present (`u` increasing
 * toward 1, the newest edge per the package orientation), scaled by `playback.speed`.
 *
 * Returns `t` unchanged when not playing. Every input is defensively finite-checked so no
 * combination of a huge `dtSeconds` (a stalled tab regaining focus) or an extreme `speed`
 * (64x) can produce `NaN` or step past the present or the start of the domain: `u` is always
 * clamped to `[0, 1]` before being unwarped back to a `GeoTime`.
 */
export function advancePlayhead(t: GeoTime, dtSeconds: number, playback: Playback, fullScale: TimeScale): GeoTime {
  if (!playback.playing) return t
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return t

  const speed = Number.isFinite(playback.speed) ? playback.speed : 0
  const baseRate = Number.isFinite(playback.baseRate) ? playback.baseRate : 0
  const du = baseRate * speed * dtSeconds

  const u0 = fullScale.toUnit(t)
  if (!Number.isFinite(u0)) return t

  const u1 = clampUnit(u0 + du)
  const next = fullScale.fromUnit(u1)
  return Number.isFinite(next) ? next : t
}

interface PlaybackLoopOptions {
  playing: boolean
  /** Called once per animation frame while playing, with the elapsed time since the previous
   *  frame in seconds. Never called with the frame in which playback starts included in its
   *  own delta (the first frame after `playing` becomes true only records a timestamp). */
  onFrame: (dtSeconds: number) => void
}

/** Drives playback off `requestAnimationFrame` while `playing` is true. Pure plumbing — the
 *  actual time advance is `advancePlayhead`, called from `onFrame` by the owner of `t`. */
export function usePlaybackLoop({ playing, onFrame }: PlaybackLoopOptions): void {
  const onFrameRef = useRef(onFrame)
  onFrameRef.current = onFrame

  useEffect(() => {
    if (!playing) return

    let rafId: number
    let last: number | null = null

    const tick = (now: number): void => {
      if (last !== null) {
        const dtSeconds = (now - last) / 1000
        onFrameRef.current(dtSeconds)
      }
      last = now
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [playing])
}
