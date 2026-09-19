/**
 * Steady-mode presentation pacing (ADR-029): decides whether a scene-to-scene transition
 * crossfades, hard-cuts (no forced-minimum dissolve eating into a brief dwell), or needs the
 * steady playhead's own rate floored so even a hard cut never flashes faster than is safe
 * (WCAG 2.3.1's three-flashes-per-second photosensitivity threshold).
 *
 * Applies only to `'steady'`-mode playback while actually playing: unpaced steady playback is
 * the only mode where `presentation.ts`'s `MIN_TRANSITION_SECONDS` can force a multi-second
 * crossfade through a cluster of scenes a few years apart, at a speed whose *natural* dwell
 * falls under that floor. `'scenes'` mode paces itself (`scene/pacing.ts`) so every scene gets
 * its exact `SCENE_DWELL_SECONDS` + `MIN_TRANSITION_SECONDS`, always well above
 * `MIN_CUT_DWELL_SECONDS`, and always crossfades. Scrubbing, seeking and paused viewing
 * crossfade too: while paused, `onFrame` never runs, so nothing here is consulted; while
 * playing, `steadyFrameRegime` (below) keeps a scrub/seek/keyboard step reading `'crossfade'`
 * regardless of what territory it lands in (`Experience.tsx`'s `lastAdvancedTRef` comparison
 * feeds it `seeked`).
 *
 * A scene's **territory** is the stretch of `t` between the midpoints (in the same log1p space
 * `sceneAt` interpolates in) of its two neighbouring gaps — exactly where `dominantScene`
 * switches, so flooring the rate across one scene's territory never disagrees with the instant
 * the caption and pip highlight also change. `sceneTerritories` computes every scene's territory
 * once; `timeline/playback.ts`'s `advanceSteadyPlayhead` takes that array *structurally* (its
 * own `SteadySceneTerritory`, satisfied by this module's output without importing it — the same
 * "shared shape, no cross-package import" convention `scene/pacing.ts`'s `PlaybackSegment` uses)
 * so it can floor the playhead's own rate without either package depending on the other.
 */

import { EARTH_FORMATION, type GeoTime, type TimeScale } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { MIN_TRANSITION_SECONDS } from './presentation'
import { tAtLogP, type PresentationRegime } from './scene'

export type { PresentationRegime }

/**
 * Below this on-screen dwell, even a hard cut would flash faster than WCAG 2.3.1's
 * three-flashes-per-second threshold allows (a full-frame content change counts as a "flash"
 * there) — the steady playhead's rate is floored so no scene is ever crossed faster than this;
 * its reciprocal, ~2.86 changes/s, leaves a small margin under the 3/s limit.
 * `timeline/playback.ts` mirrors this constant by value so the floor it applies to `t` agrees
 * with the regime this module reports for the same territory.
 */
export const MIN_CUT_DWELL_SECONDS = 0.35

export interface SteadyPacing {
  /** How `presentation.ts`'s `step` should render the current transition. */
  regime: PresentationRegime
  /** True exactly while the steady playhead's rate is floored below what `speed` requested to
   *  guarantee the minimum dwell — a direct function of playback state (this call's own `t`,
   *  `rawRate` and `scale`), never an idle timer. Drives the "time compressed" marker. */
  floored: boolean
}

export interface SteadySceneTerritory {
  /** Nearer-to-present edge — the `t` at which `dominantScene` switches into this scene. `0` for
   *  the newest scene (nothing is nearer the present than it). */
  tNewer: GeoTime
  /** Farther-into-the-past edge. `EARTH_FORMATION` for the oldest scene. */
  tOlder: GeoTime
}

/**
 * Every scene's territory (see the module doc comment), in the same order as `scenes` (ascending
 * `t`). `[]` for fewer than two scenes: no gap to place a territory boundary in.
 */
export function sceneTerritories(scenes: readonly Scene[]): SteadySceneTerritory[] {
  if (scenes.length < 2) return []
  return scenes.map((scene, index) => ({
    tNewer: index === 0 ? 0 : tAtLogP(scenes[index - 1]!.t, scene.t, 0.5),
    tOlder: index === scenes.length - 1 ? EARTH_FORMATION : tAtLogP(scene.t, scenes[index + 1]!.t, 0.5),
  }))
}

/**
 * The territory containing `t` — `territories` must be contiguous and ascending by `tNewer`
 * (exactly `sceneTerritories`' own output). At an exact shared boundary, returns the *older*
 * (higher-index) territory, reproducing `dominantScene`'s own tie-break (`mix < 0.5 ? from : to`
 * picks the older scene when `mix` lands exactly on `0.5`) without needing `sceneAt`/
 * `dominantScene` at query time. `undefined` for an empty `territories`.
 */
export function territoryAt(territories: readonly SteadySceneTerritory[], t: GeoTime): SteadySceneTerritory | undefined {
  if (territories.length === 0) return undefined
  let lo = 0
  let hi = territories.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (territories[mid]!.tNewer <= t) lo = mid + 1
    else hi = mid
  }
  return territories[Math.max(0, lo - 1)]
}

/**
 * The presentation regime and floor status for steady-mode playback at `t`, crossing scenes at
 * `rawRate` (`u`/s in `scale` — `playback.baseRate * playback.speed`). Pure in its inputs.
 *
 * No territory containing `t` (fewer than two scenes) or a non-positive `rawRate` has nothing to
 * floor or cut: `{ regime: 'crossfade', floored: false }`, matching `sceneAt`'s own single-scene
 * degenerate case and today's unconditional crossfade.
 */
export function steadyPacing(territories: readonly SteadySceneTerritory[], t: GeoTime, rawRate: number, scale: TimeScale): SteadyPacing {
  const territory = territoryAt(territories, t)
  if (territory === undefined || !(rawRate > 0)) return { regime: 'crossfade', floored: false }

  const uSpan = Math.abs(scale.toUnit(territory.tOlder) - scale.toUnit(territory.tNewer))
  const dwellSeconds = uSpan / rawRate

  if (dwellSeconds >= MIN_TRANSITION_SECONDS) return { regime: 'crossfade', floored: false }
  if (dwellSeconds >= MIN_CUT_DWELL_SECONDS || uSpan === 0) return { regime: 'cut', floored: false }
  return { regime: 'cut', floored: true }
}

/**
 * `steadyPacing`, wrapped for `Experience.tsx`'s playback loop:
 *
 * - **Evaluated at `renderedT`**, the `t` this frame actually commits and renders
 *   (`advanceSteadyPlayhead`'s return value), not the `t` playback started the frame at. Reading
 *   the pre-advance `t` leaves the regime one frame stale relative to what `SceneView` and the
 *   once-mode sound trigger see: on the frame `t` crosses from a comfortably-paced territory
 *   into a dense `'cut'` one, a stale read would still say `'crossfade'`, so a once-mode sound
 *   landing exactly on that boundary could fire against the wrong regime.
 * - **`seeked`**: `true` for a frame whose *starting* `t` was not the previous frame's own
 *   `advanceSteadyPlayhead` output — a scrub, a checkpoint/event jump, a keyboard step, or any
 *   other direct `setT` between the two — forces `'crossfade'`/not-floored regardless of what
 *   the landed-on territory implies. Without this, steady playback would hard-cut through
 *   whatever territory a drag or keyboard step landed in; this keeps it reading as the ordinary
 *   rate-limited crossfade, governed by `presentation.ts`'s `MIN_TRANSITION_SECONDS` rather than
 *   this file's `MIN_CUT_DWELL_SECONDS`.
 *
 * Pure in its five inputs — `seeked` is the caller's own comparison against what it tracked
 * last frame, not computed here.
 */
export function steadyFrameRegime(
  territories: readonly SteadySceneTerritory[],
  renderedT: GeoTime,
  rawRate: number,
  scale: TimeScale,
  seeked: boolean,
): SteadyPacing {
  if (seeked) return { regime: 'crossfade', floored: false }
  return steadyPacing(territories, renderedT, rawRate, scale)
}
