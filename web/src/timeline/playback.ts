'use client'

/**
 * Playback (DESIGN §3). Two modes, each with its own rate (`playbackRates.ts` holds the detents):
 *
 * - **`'scenes'`** (default) — `advancePlayhead` crosses `scenesPacing`'s segments
 *   (`scene/pacing.ts`'s `scenePlaybackSegments`) at exactly the velocity that makes each one take
 *   its `durationSeconds / speed`, in the full-domain symlog `u` of `fullScale`. Outside every
 *   segment `u` moves at the flat `baseRate * speed`. (ADR-016)
 * - **`'steady'`** — `advanceSteadyPlayhead` moves `t` at a literal `yearsPerSecond`, whatever the
 *   selected section or scale kind, so the rate a viewer picks is the rate they get anywhere on
 *   the timeline (ADR-050). It is integrated in years directly rather than through a scale's
 *   `u`, so no section boundary or scale warp enters the step.
 *
 * Steady mode's one exception is a per-scene floor (ADR-029): inside a scene's territory (the
 * stretch of `t` where it is the dominant scene) whose dwell at the requested rate would fall
 * under `MIN_CUT_DWELL_SECONDS`, the rate is slowed to exactly that dwell, so a full-frame image
 * change never comes faster than about three a second. It only ever slows playback, and only
 * across the territory that needs it. Territories arrive structurally (`SteadySceneTerritory`,
 * satisfied by `scene/steadyPacing.ts`'s `sceneTerritories`) so this package does not import
 * `@/scene`.
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
 * Advances `t` by one frame of playback, toward the present. For `'scenes'` mode `fullScale` is
 * the full-domain symlog scale: `scenesPacing` is crossed at exactly the velocity that spends each
 * segment's `durationSeconds / speed`, and `u` outside every segment (or with no segments loaded)
 * moves at `baseRate * speed`. `'steady'` mode ignores `fullScale` and `scenesPacing` and moves at
 * `yearsPerSecond` with no per-scene floor; the playback loop calls `advanceSteadyPlayhead`
 * directly to get the floor.
 *
 * Returns `t` unchanged when not playing. A huge `dtSeconds` (a stalled tab regaining focus) or
 * an extreme rate never produces `NaN` or steps past the present or the start of the domain.
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
  if (playback.mode === 'steady') return advanceSteadyPlayhead(t, dtSeconds, playback)

  const speed = Number.isFinite(playback.speed) ? playback.speed : 0
  const baseRate = Number.isFinite(playback.baseRate) ? playback.baseRate : 0

  const u0 = fullScale.toUnit(t)
  if (!Number.isFinite(u0)) return t

  const u1 = integratePacedUnit(u0, dtSeconds, baseRate * speed, buildRatedUSegments(scenesPacing, fullScale, baseRate, speed))

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

/** A scene's territory (ADR-029), structurally `scene/steadyPacing.ts`'s `SteadySceneTerritory`. */
export interface SteadySceneTerritory {
  /** Nearer-to-present edge of the territory. */
  tNewer: GeoTime
  /** Farther-into-the-past edge. */
  tOlder: GeoTime
}

/** Mirrors `scene/steadyPacing.ts`'s `MIN_CUT_DWELL_SECONDS` by value, so the floor applied to
 *  `t` here agrees with the regime that module reports for the same territory. */
const MIN_CUT_DWELL_SECONDS = 0.35

/** The index of the territory containing `t` in `territories` (contiguous, ascending by
 *  `tNewer`). An exact shared boundary resolves to the older (higher-index) territory, matching
 *  `dominantScene`'s tie-break. `-1` for an empty array. */
function steadyTerritoryIndexAt(territories: readonly SteadySceneTerritory[], t: GeoTime): number {
  if (territories.length === 0) return -1
  let lo = 0
  let hi = territories.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (territories[mid]!.tNewer <= t) lo = mid + 1
    else hi = mid
  }
  return Math.max(0, lo - 1)
}

/** The rate, in years per second, at which steady playback crosses a territory `spanYears` wide
 *  when `yearsPerSecond` is requested: the request itself, or slower if the scene would otherwise
 *  dwell under `MIN_CUT_DWELL_SECONDS`. */
export function flooredSteadyRate(spanYears: number, yearsPerSecond: number): number {
  return spanYears > 0 && spanYears / yearsPerSecond < MIN_CUT_DWELL_SECONDS ? spanYears / MIN_CUT_DWELL_SECONDS : yearsPerSecond
}

/**
 * `'steady'`-mode playback: moves `t` toward the present by `playback.yearsPerSecond` years per
 * second of `dtSeconds`, stopping at the present. With `sceneTerritories`, each territory is
 * crossed at `flooredSteadyRate` instead, stepping from one territory to the next by index so a
 * `dtSeconds` spanning several of them bills each its own dwell. Omitted or `[]` applies no floor.
 *
 * `playback.mode` must be `'steady'`.
 */
export function advanceSteadyPlayhead(
  t: GeoTime,
  dtSeconds: number,
  playback: Playback,
  sceneTerritories: readonly SteadySceneTerritory[] = [],
): GeoTime {
  if (playback.mode !== 'steady') {
    throw new Error(`advanceSteadyPlayhead: playback.mode must be 'steady', got '${playback.mode}'`)
  }
  if (!playback.playing || !Number.isFinite(dtSeconds) || dtSeconds <= 0 || !Number.isFinite(t)) return t
  const requested = playback.yearsPerSecond
  if (!(requested > 0) || !Number.isFinite(requested)) return t

  let current = Math.max(0, t)
  let remaining = dtSeconds
  let territoryIndex = steadyTerritoryIndexAt(sceneTerritories, current)

  for (;;) {
    const territory = territoryIndex >= 0 ? sceneTerritories[territoryIndex] : undefined
    const rate = territory === undefined ? requested : flooredSteadyRate(territory.tOlder - territory.tNewer, requested)
    const boundary = territory === undefined ? 0 : Math.max(0, territory.tNewer)
    if (boundary > current) {
      territoryIndex -= 1
      continue
    }

    const secondsToBoundary = (current - boundary) / rate
    if (secondsToBoundary >= remaining) return Math.max(boundary, current - rate * remaining)
    remaining -= secondsToBoundary
    if (boundary === 0) return 0

    current = boundary
    territoryIndex -= 1
  }
}
