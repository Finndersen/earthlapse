'use client'

/**
 * Playback (DESIGN §3): "the playhead moves at constant velocity in warped screen space...
 * Speed control is a scalar multiplier on that velocity; nothing else changes."
 *
 * > **v1 note (ADR-016).** Two explicit modes, both scaled by `playback.speed`, replace the
 * > single velocity-capped hybrid ADR-012 introduced:
 * >
 * > - **`'scenes'`** (default) — `advancePlayhead` moves through `scenesPacing`'s segments
 * >   (`scene/pacing.ts`'s `scenePlaybackSegments`) at exactly the velocity that makes each one
 * >   take its `durationSeconds`, in the *full-domain symlog* `u` of `fullScale` (the caller's
 * >   contract, not this function's — see `usePlaybackLoop`'s caller). Unlike ADR-012, there is
 * >   no `baseRate` cap inside a segment: a sparse gap simply moves faster than `baseRate` for
 * >   its `durationSeconds`, which is the point (ADR-016 — "the fast-moving playhead ... conveys
 * >   elapsed time in big gaps"). Outside every segment — before the first scene, after the
 * >   last — `t` moves at the ordinary flat `baseRate * speed`, exactly as `'steady'` mode does
 * >   everywhere.
 * > - **`'steady'`** — flat `baseRate * speed` everywhere, no pacing at all. The caller is
 * >   expected to pass whichever full-domain scale (symlog or linear) matches the currently
 * >   selected `ScaleKind`, so speed reads as constant in whatever axis is on screen.
 */

import { useEffect, useRef } from 'react'

import type { GeoTime, Playback, TimeScale } from '@/types/layer'

import { clampUnit } from './util'

/**
 * A stretch of `t` (`[tNewer, tOlder]`, `tNewer <= tOlder`) that `'scenes'`-mode
 * `advancePlayhead` spends exactly `durationSeconds` of wall-clock time crossing, before
 * `playback.speed` divides it down. Structural, not imported from `@/scene` — `scene`'s
 * `PlaybackSegment` satisfies this shape exactly, so `scenePlaybackSegments(scenes)` can be
 * passed straight through, but this package does not depend on `@/scene` to name the type.
 */
export interface PlaybackPacingSegment {
  tNewer: GeoTime
  tOlder: GeoTime
  durationSeconds: number
}

/** One `scenesPacing` segment converted into the `u` space `fullScale` measures, sorted
 *  ascending — the direction `u` increases while playback runs. `rate` is `u` per wall-clock
 *  second, already scaled by `speed`. */
interface RatedUSegment {
  uLow: number
  uHigh: number
  rate: number
}

/**
 * Converts and sorts `segments` into `u`-space segments, each rated at exactly the velocity
 * that spends `durationSeconds` crossing it (no cap — ADR-016 removed the ADR-012 hybrid's
 * `Math.min(baseRate, ...)`), scaled by `speed`.
 *
 * A zero-width segment (`uSpan === 0`) would divide to an exact rate of 0, which — inside
 * `integratePacedUnit` — is read as "cannot make progress" and stops integration dead rather
 * than skipping past it (see that function's own doc comment). But a zero-width segment has
 * nothing to cross: `integratePacedUnit` resolves it in a single, instant step regardless of
 * the rate's actual value (`timeToBoundary` is `0 / rate = 0` either way). So the fallback
 * here only needs to stay positive, not meaningful — `baseRate * speed` is a convenient one,
 * not a cap making a comeback.
 */
function buildRatedUSegments(
  segments: readonly PlaybackPacingSegment[],
  fullScale: TimeScale,
  baseRate: number,
  speed: number,
): RatedUSegment[] {
  const rated = segments.map(({ tNewer, tOlder, durationSeconds }): RatedUSegment => {
    const uAtNewer = fullScale.toUnit(tNewer)
    const uAtOlder = fullScale.toUnit(tOlder)
    const uLow = Math.min(uAtNewer, uAtOlder)
    const uHigh = Math.max(uAtNewer, uAtOlder)
    const uSpan = uHigh - uLow
    const rate = uSpan > 0 && durationSeconds > 0 ? (uSpan / durationSeconds) * speed : baseRate * speed
    return { uLow, uHigh, rate }
  })
  rated.sort((a, b) => a.uLow - b.uLow)
  return rated
}

/**
 * Integrates `u` forward from `u0` by `dtSeconds` of wall-clock time, at `outsideRate`
 * (`baseRate * speed`) outside every segment and at that segment's own exact rate inside one,
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
 * Advances `t` by one frame of playback. Always moves toward the present (`u` increasing
 * toward 1, the newest edge per the package orientation) in `fullScale`'s warped `u` — the
 * caller's job is to pass the right *full-domain* scale for `playback.mode` (never the current
 * visible window's, so zoom never changes playback speed): the full-domain symlog scale for
 * `'scenes'` mode always, and the full-domain scale of whichever `ScaleKind` is on screen for
 * `'steady'` mode (ADR-016). Scaled by `playback.speed` throughout.
 *
 * - **`playback.mode === 'scenes'`**: `scenesPacing` (intended to be `scene/pacing.ts`'s
 *   `scenePlaybackSegments(scenes)`, satisfying this package's structural
 *   `PlaybackPacingSegment` without `timeline` importing `@/scene`) is crossed at exactly the
 *   velocity that spends each segment's `durationSeconds`; `u` outside every segment moves at
 *   the ordinary `baseRate * speed`. An empty or omitted `scenesPacing` (no scenes loaded yet)
 *   degrades to that same flat rate everywhere — there is nothing to pace.
 * - **`playback.mode === 'steady'`**: flat `baseRate * speed` everywhere; `scenesPacing` is
 *   ignored.
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
  scenesPacing: readonly PlaybackPacingSegment[] = [],
): GeoTime {
  if (!playback.playing) return t
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) return t

  const speed = Number.isFinite(playback.speed) ? playback.speed : 0
  const baseRate = Number.isFinite(playback.baseRate) ? playback.baseRate : 0

  const u0 = fullScale.toUnit(t)
  if (!Number.isFinite(u0)) return t

  const u1 =
    playback.mode === 'scenes'
      ? integratePacedUnit(u0, dtSeconds, baseRate * speed, buildRatedUSegments(scenesPacing, fullScale, baseRate, speed))
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
