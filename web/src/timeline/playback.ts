'use client'

/**
 * Playback (DESIGN §3): "the playhead moves at constant velocity in warped screen space...
 * Speed control is a scalar multiplier on that velocity; nothing else changes."
 *
 * > **v1 note (ADR-012).** Constant velocity is now capped, not flat: an optional `pacing`
 * > argument to `advancePlayhead` slows the playhead — never speeds it up — while crossing a
 * > stretch of `t` that must take at least a minimum wall-clock duration, so every scene
 * > dwells and every dissolve band takes its minimum time even where consecutive scenes sit
 * > only a percent or two of `u` apart. All of it is still scaled by `playback.speed`. See
 * > `scene/pacing.ts`'s `scenePlaybackSegments` for where the durations come from and why this
 * > paces the playhead rather than the displayed presentation.
 */

import { useEffect, useRef } from 'react'

import type { GeoTime, Playback, TimeScale } from '@/types/layer'

import { clampUnit } from './util'

/**
 * A stretch of `t` (`[tNewer, tOlder]`, `tNewer <= tOlder`) that `advancePlayhead` must spend
 * at least `minSeconds` of wall-clock time crossing, before `playback.speed` divides it down.
 * Structural, not imported from `@/scene` — `scene`'s `PlaybackSegment` satisfies this shape
 * exactly, so `scenePlaybackSegments(scenes)` can be passed straight through, but this package
 * does not depend on `@/scene` to name the type.
 */
export interface PlaybackPacingSegment {
  tNewer: GeoTime
  tOlder: GeoTime
  minSeconds: number
}

/** One `pacing` segment converted into the `u` space `fullScale` measures, sorted ascending —
 *  the direction `u` increases while playback runs. `rate` is `u` per wall-clock second,
 *  already scaled by `speed`. */
interface RatedUSegment {
  uLow: number
  uHigh: number
  rate: number
}

/** Converts and sorts `pacing` into `u`-space segments, capping each one's velocity at
 *  `baseRate` (never raising it — a sparse gap, wider in `u` than its `minSeconds` demands,
 *  simply runs at the ordinary `baseRate`) and scaling by `speed`. A degenerate (zero-width)
 *  segment cannot meaningfully cap anything, so it is left at the ordinary rate rather than
 *  dividing by zero. */
function buildRatedUSegments(
  pacing: readonly PlaybackPacingSegment[],
  fullScale: TimeScale,
  baseRate: number,
  speed: number,
): RatedUSegment[] {
  const segments = pacing.map(({ tNewer, tOlder, minSeconds }): RatedUSegment => {
    const uAtNewer = fullScale.toUnit(tNewer)
    const uAtOlder = fullScale.toUnit(tOlder)
    const uLow = Math.min(uAtNewer, uAtOlder)
    const uHigh = Math.max(uAtNewer, uAtOlder)
    const uSpan = uHigh - uLow
    const cappedRate = uSpan > 0 && minSeconds > 0 ? Math.min(baseRate, uSpan / minSeconds) : baseRate
    return { uLow, uHigh, rate: cappedRate * speed }
  })
  segments.sort((a, b) => a.uLow - b.uLow)
  return segments
}

/**
 * Integrates `u` forward from `u0` by `dtSeconds` of wall-clock time, at `outsideRate`
 * (`baseRate * speed`) outside every segment and at that segment's own capped rate inside one,
 * crossing as many segment boundaries as `dtSeconds` reaches within this one call (a large
 * `dtSeconds` — a stalled tab regaining focus — can cross several). A rate of exactly 0 (a
 * defensively-zeroed `baseRate` or `speed`) cannot make progress; rather than spin forever,
 * integration stops there; matches the un-paced formula's own zero-rate behaviour.
 */
function integratePacedUnit(u0: number, dtSeconds: number, outsideRate: number, uSegments: readonly RatedUSegment[]): number {
  let u = u0
  let remaining = dtSeconds

  let i = 0
  while (i < uSegments.length && uSegments[i]!.uHigh <= u) i++

  while (remaining > 0 && u < 1) {
    const seg = i < uSegments.length ? uSegments[i]! : undefined
    const inSegment = seg !== undefined && u >= seg.uLow
    const rate = inSegment ? seg.rate : outsideRate
    const boundary = inSegment ? seg.uHigh : (seg?.uLow ?? 1)

    if (rate <= 0) break

    const timeToBoundary = (boundary - u) / rate
    if (timeToBoundary >= remaining) {
      u += rate * remaining
      remaining = 0
    } else {
      u = boundary
      remaining -= timeToBoundary
      if (inSegment) i++
    }
  }

  return clampUnit(u)
}

/**
 * Advances `t` by one frame of playback. Moves at constant velocity in the warped `u` of
 * `fullScale` — always the *full-domain* scale, never the current visible window's, so
 * playback speed does not change when the user zooms — toward the present (`u` increasing
 * toward 1, the newest edge per the package orientation), scaled by `playback.speed`.
 *
 * `pacing`, if given (ADR-012), caps that velocity downward — never up — while `u` crosses one
 * of its segments, so each one takes at least its `minSeconds` (divided by `speed`) of
 * wall-clock time; `u` outside every segment moves at the ordinary `baseRate * speed`, exactly
 * as when `pacing` is omitted. `scene/pacing.ts`'s `scenePlaybackSegments(scenes)` is the
 * intended source of `pacing`, satisfying this package's structural `PlaybackPacingSegment`
 * without `timeline` importing `@/scene`.
 *
 * Returns `t` unchanged when not playing. Every input is defensively finite-checked so no
 * combination of a huge `dtSeconds` (a stalled tab regaining focus) or an extreme `speed`
 * (64x) can produce `NaN` or step past the present or the start of the domain: `u` is always
 * clamped to `[0, 1]` before being unwarped back to a `GeoTime`.
 */
export function advancePlayhead(
  t: GeoTime,
  dtSeconds: number,
  playback: Playback,
  fullScale: TimeScale,
  pacing?: readonly PlaybackPacingSegment[],
): GeoTime {
  if (!playback.playing) return t
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return t

  const speed = Number.isFinite(playback.speed) ? playback.speed : 0
  const baseRate = Number.isFinite(playback.baseRate) ? playback.baseRate : 0

  const u0 = fullScale.toUnit(t)
  if (!Number.isFinite(u0)) return t

  const u1 =
    pacing && pacing.length > 0
      ? integratePacedUnit(u0, dtSeconds, baseRate * speed, buildRatedUSegments(pacing, fullScale, baseRate, speed))
      : clampUnit(u0 + baseRate * speed * dtSeconds)

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
