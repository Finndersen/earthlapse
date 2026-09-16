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
 * > - **`'steady'`** — flat `baseRate * speed` everywhere, no pacing at all, measured in the
 * >   scale (symlog or linear) of whichever `ScaleKind` is currently selected, so speed reads as
 * >   constant in whatever axis is on screen.
 * >
 * > **ADR-024.** Era sections narrow the window, and playback carries on past a section's end
 * > into the next one. `'scenes'` mode is unchanged: scene durations belong to the scenes, not
 * > the window. `'steady'` mode moves at constant velocity in the *selected section's* scale
 * > (`advanceSteadyPlayhead`), so every section takes the same wall-clock time to cross at 1x.
 * >
 * > **ADR-029.** Constant `u`-velocity in `'steady'` mode means constant *screen-space* speed,
 * > not constant on-screen dwell per scene — a scene-dense stretch (recent human history is the
 * > worst case: 28 of 68 scenes in the last 12,000 years) can dwell under
 * > `presentation.ts`'s `MIN_TRANSITION_SECONDS`, which then rate-limits every crossing to a
 * > forced multi-second dissolve regardless, reading as one blur through the whole stretch.
 * > `advanceSteadyPlayhead` now takes an optional `sceneTerritories` (`scene/steadyPacing.ts`'s
 * > `sceneTerritories(scenes)`, structurally — this package does not import `@/scene`, the same
 * > "shared shape, no cross-package import" convention `scenesPacing` above already established):
 * > below `MIN_CUT_DWELL_SECONDS` of natural dwell for the scene `t` is currently in, the
 * > playhead's own rate is floored to guarantee that dwell — a hard safety floor (WCAG 2.3.1's
 * > three-flashes-per-second threshold), independent of whatever `scene/steadyPacing.ts` decides
 * > to *render* (crossfade vs. a hard cut) at that rate; this package only needs the numeric
 * > floor. `sceneTerritories` omitted (or `[]`, the default) reproduces this function's pre-
 * > ADR-029 behaviour exactly — every existing caller/test needs no change.
 */

import { useEffect, useRef } from 'react'

import type { GeoTime, Playback, TimeScale } from '@/types/layer'

import type { TimeWindow } from './scale'
import { continuationSection, sectionById, sectionContains, type SectionId } from './sections'
import { clampUnit } from './util'

/** The discrete multipliers the speed select offers, and what `[`/`]`/`-`/`=` step through
 *  (`timeline/keyboard.ts`'s `'speed'` intent, follow-up pass item 3) — one shared list so the
 *  dropdown, the shortcuts and their hint/tooltip text can never drift apart. */
export const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64] as const

/**
 * The next value in `SPEED_OPTIONS` in `direction` from `current`, clamped at either end — no
 * wrap. Wrapping the fast end back to 0.25x (or the reverse) would be a jarring jump mid
 * playback, unlike a volume knob where wrapping is harmless.
 *
 * `current` not being an exact option (defensive: nothing in the store can produce this today,
 * but a future caller might pass an arbitrary number) resolves to the nearest option on
 * `direction`'s side, so an off-list value still moves the right way instead of snapping to an
 * unrelated end.
 */
export function stepSpeed(current: number, direction: 'up' | 'down'): number {
  const exactIndex = SPEED_OPTIONS.indexOf(current as (typeof SPEED_OPTIONS)[number])
  if (exactIndex !== -1) {
    const nextIndex = direction === 'up' ? Math.min(exactIndex + 1, SPEED_OPTIONS.length - 1) : Math.max(exactIndex - 1, 0)
    return SPEED_OPTIONS[nextIndex]!
  }
  const onSide =
    direction === 'up' ? SPEED_OPTIONS.filter((option) => option > current) : [...SPEED_OPTIONS].reverse().filter((option) => option < current)
  return onSide[0] ?? (direction === 'up' ? SPEED_OPTIONS[SPEED_OPTIONS.length - 1]! : SPEED_OPTIONS[0])
}

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
 * toward 1, the newest edge per the package orientation) in `fullScale`'s warped `u`. Scaled by
 * `playback.speed` throughout. The caller picks the scale for `playback.mode`. For `'scenes'`
 * it is always the full-domain symlog scale (ADR-016), which never changes with the selected
 * section. For `'steady'` it is one section's scale of the selected `ScaleKind`, and
 * `advanceSteadyPlayhead` (ADR-024) is what calls this, one section at a time.
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

/**
 * A scene's on-screen territory (ADR-029), structurally satisfied by `scene/steadyPacing.ts`'s
 * `SteadySceneTerritory` without this package importing `@/scene` — the same convention
 * `PlaybackPacingSegment` above already established for `scenePlaybackSegments`'s output.
 */
export interface SteadySceneTerritory {
  /** Nearer-to-present edge of the territory. */
  tNewer: GeoTime
  /** Farther-into-the-past edge. */
  tOlder: GeoTime
}

/**
 * Mirrors `scene/steadyPacing.ts`'s `MIN_CUT_DWELL_SECONDS` by value (kept in sync by hand, not
 * by importing `@/scene` — see `scene/pacing.ts`'s own `SYMLOG_C` mirror for the same "package
 * stays self-contained" reasoning). Below this on-screen dwell even a hard cut would flash faster
 * than WCAG 2.3.1's three-flashes-per-second threshold allows, so `advanceSteadyPlayhead` floors
 * its own rate to guarantee it — independent of whatever `scene/steadyPacing.ts` decides to
 * *render* (crossfade vs. cut) at that rate; this package only needs the numeric floor. */
const MIN_CUT_DWELL_SECONDS = 0.35

/** The *index* into `territories` of the territory containing `t` — mirrors
 *  `scene/steadyPacing.ts`'s `territoryAt` by algorithm (not by import; see
 *  `MIN_CUT_DWELL_SECONDS`'s own doc comment for why): `territories` must be contiguous and
 *  ascending by `tNewer`, exactly `sceneTerritories`' own output, and an exact shared boundary
 *  resolves to the *older* (higher-index) territory, reproducing `dominantScene`'s own tie-break
 *  without needing scene identity at query time. `-1` for an empty array.
 *
 *  Returning the index rather than the territory object itself is what lets
 *  `advanceSteadyPlayhead` below step to the next territory by decrementing it directly once it
 *  crosses a boundary, instead of re-deriving the territory from a nudged `t` (re-review fix,
 *  2026-09-15 — see that function's own doc comment for why a numeric nudge in `u` was wrong). */
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

/**
 * `'steady'`-mode playback inside the era section `sectionId` (ADR-024). Speed is constant in
 * that section's own scale, `scaleForWindow(section.window)` (the selected `ScaleKind` over the
 * section), so crossing any section takes the same wall-clock time at 1x. When the playhead
 * runs off the section's younger edge, the rest of `dtSeconds` carries on in
 * `continuationSection`'s scale. A frame that crosses an edge therefore neither stalls on it
 * nor loses time. A playhead resting exactly on the edge crosses at once on the next frame.
 * Stops at the present like `advancePlayhead`.
 *
 * `t` must lie inside `sectionId` (the time store keeps that invariant), and `playback.mode`
 * must be `'steady'`. `'scenes'` mode always uses `advancePlayhead` on the full-domain scale.
 *
 * `sceneTerritories` (ADR-029, default `[]`): whenever `t` sits inside a territory whose natural
 * dwell at the requested rate (`uSpan / (baseRate * speed)`, in the *current* section's scale —
 * recomputed fresh every territory, so a section change mid-call picks up its own scale exactly
 * like the un-floored edge-crossing below always has) would fall under `MIN_CUT_DWELL_SECONDS`,
 * the rate for crossing that specific territory is floored to `uSpan / MIN_CUT_DWELL_SECONDS`
 * instead — slowing `t` just enough that the scene still gets the minimum dwell, then resuming
 * the requested rate once past it. `[]` (or omitted) finds no territory ever, so the loop below
 * always uses the plain requested rate — byte-for-byte this function's pre-ADR-029 behaviour.
 *
 * Crossing a territory boundary steps `territoryIndex` directly (decrementing toward the
 * newest/index-0 territory, the direction playback always moves) rather than re-deriving it by
 * re-querying `steadyTerritoryIndexAt` at a `t` nudged past the boundary (re-review fix,
 * 2026-09-15, replacing the original `TERRITORY_STEP_EPSILON_U` approach): a fixed nudge in `u`
 * is not "physically meaningless" the way it was documented — under a *linear* steady scale over
 * a wide window (the root `earth` section, say), a tiny `u` nudge is a large, real span of years
 * (order 1e-9 of a 4.6 Gyr domain is several years), comparable to or wider than some scene
 * territories a few years across, so the nudge could skip a whole territory (or eat most of its
 * floored dwell) without ever billing any time for it — live-measured up to 9 image changes in a
 * single second before this fix, well over the 3/s safety limit the floor exists to guarantee.
 * Stepping the index costs nothing to compute, needs no `u`-space tolerance at all, and
 * terminates in at most `sceneTerritories.length` steps regardless of how the scale warps `t`.
 */
export function advanceSteadyPlayhead(
  t: GeoTime,
  dtSeconds: number,
  playback: Playback,
  sectionId: SectionId,
  scaleForWindow: (window: TimeWindow) => TimeScale,
  sceneTerritories: readonly SteadySceneTerritory[] = [],
): GeoTime {
  if (playback.mode !== 'steady') {
    throw new Error(`advanceSteadyPlayhead: playback.mode must be 'steady', got '${playback.mode}'`)
  }
  if (!playback.playing || !Number.isFinite(dtSeconds) || dtSeconds <= 0) return t

  const speed = Number.isFinite(playback.speed) ? playback.speed : 0
  const baseRate = Number.isFinite(playback.baseRate) ? playback.baseRate : 0
  const rawRate = baseRate * speed
  if (!(rawRate > 0)) return t

  let section = sectionById(sectionId)
  if (!sectionContains(section, t)) {
    throw new Error(`advanceSteadyPlayhead: t=${t} is outside section '${sectionId}'`)
  }

  let current = t
  let remaining = dtSeconds
  // Looked up once, then stepped by index as boundaries are crossed (see this function's own
  // doc comment) — never re-derived from `current` after a territory crossing, so no `u`-space
  // tolerance is needed to avoid re-querying the territory just left. A section-continuation
  // crossing (below) leaves `current` at the same real `t`, just re-scaled, so it never needs a
  // fresh lookup either — only an actual territory-boundary crossing moves this.
  let territoryIndex = steadyTerritoryIndexAt(sceneTerritories, current)

  for (;;) {
    const scale = scaleForWindow(section.window)
    const currentU = clampUnit(scale.toUnit(current))

    const territory = territoryIndex >= 0 ? sceneTerritories[territoryIndex] : undefined
    let rate = rawRate
    let boundaryU = 1
    if (territory !== undefined) {
      const uSpan = Math.abs(scale.toUnit(territory.tOlder) - scale.toUnit(territory.tNewer))
      if (uSpan > 0 && uSpan / rawRate < MIN_CUT_DWELL_SECONDS) rate = uSpan / MIN_CUT_DWELL_SECONDS
      boundaryU = Math.min(clampUnit(scale.toUnit(territory.tNewer)), 1)
    }

    const uToBoundary = Math.max(0, boundaryU - currentU)
    const secondsToBoundary = uToBoundary / rate

    if (secondsToBoundary >= remaining) {
      return scale.fromUnit(clampUnit(currentU + rate * remaining))
    }
    remaining -= secondsToBoundary

    if (boundaryU >= 1) {
      const next = continuationSection(section.id)
      if (next === undefined) return scale.fromUnit(1)
      current = section.window[0]
      section = next
    } else {
      // Exactly `territory.tNewer` — the boundary just paid for above, not a nudge past it — and
      // the next territory nearer the present, by index, not by re-querying at this (exact,
      // untainted-by-rounding) boundary value.
      current = territory!.tNewer
      territoryIndex -= 1
    }
  }
}
