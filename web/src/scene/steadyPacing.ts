/**
 * Steady-mode presentation pacing (ADR-029): the generic "how long is each scene actually on
 * screen" rule that decides whether a scene-to-scene transition crossfades (today's unconditional
 * behaviour), hard-cuts (visibly faster — no forced-minimum dissolve eating into a brief dwell),
 * or needs the steady playhead's own rate floored so even a hard cut never flashes faster than is
 * safe (WCAG 2.3.1's three-flashes-per-second photosensitivity threshold).
 *
 * Applies only to `'steady'`-mode playback while actually playing — the problem this fixes
 * (`presentation.ts`'s `MIN_TRANSITION_SECONDS` forcing a multi-second crossfade through a
 * cluster of scenes a few years apart, at whatever speed makes each scene's *natural* dwell fall
 * under that floor) is specific to unpaced steady playback. `'scenes'` mode paces itself
 * (`scene/pacing.ts`) so every scene already gets its exact `SCENE_DWELL_SECONDS` +
 * `MIN_TRANSITION_SECONDS`, always well above `MIN_CUT_DWELL_SECONDS`, and always crossfades.
 * Scrubbing, seeking and paused viewing crossfade too: while paused, `onFrame` never runs at
 * all, so nothing here is ever consulted; while playing, `steadyFrameRegime` (below) is what
 * keeps a scrub/seek/keyboard step reading `'crossfade'` regardless of what territory it lands
 * in (`Experience.tsx`'s own `lastAdvancedTRef` comparison feeds it `seeked`) — see that
 * function's own doc comment for the 2026-09-15 re-review fix this replaced a simpler, and
 * false, "onFrame never runs during a drag" claim with.
 *
 * A scene's **territory** is the stretch of `t` between the midpoints (in the same log1p space
 * `sceneAt` interpolates in) of its two neighbouring gaps — exactly where `dominantScene` itself
 * switches, so flooring the rate across one scene's territory never disagrees with the instant the
 * caption and pip highlight also change. `sceneTerritories` computes every scene's territory once;
 * `timeline/playback.ts`'s `advanceSteadyPlayhead` takes that array *structurally* (its own
 * `SteadySceneTerritory`, satisfied by this module's output without importing it — the same
 * "shared shape, no cross-package import" convention `scene/pacing.ts`'s `PlaybackSegment` /
 * `timeline/playback.ts`'s `PlaybackPacingSegment` already established) so it can floor the
 * playhead's own rate without either package depending on the other.
 */

import { EARTH_FORMATION, type GeoTime, type TimeScale } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { MIN_TRANSITION_SECONDS } from './presentation'
import { tAtLogP, type PresentationRegime } from './scene'

export type { PresentationRegime }

/**
 * Below this on-screen dwell, even a hard cut would flash faster than WCAG 2.3.1's
 * three-flashes-per-second threshold allows (a full-frame content change counts as a "flash"
 * there) — the steady playhead's own rate is floored so no scene is ever crossed faster than
 * this; its reciprocal, ~2.86 changes/s, leaves a small margin under the 3/s limit.
 * `timeline/playback.ts` mirrors this constant by value (see its own doc comment) so the floor it
 * actually applies to `t` agrees with the regime this module reports for the same territory.
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
 * `t`, `sceneAt`'s own convention — nearest the present first). `[]` for fewer than two scenes:
 * there is no gap to place a territory boundary in, so nothing here can ever need a floor.
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
 * (higher-index) territory: `sceneTerritories`' boundaries are built from `tAtLogP(..., 0.5)`,
 * the same formula `sceneAt` computes its own dissolve position from, and `dominantScene`'s tie-
 * break (`mix < 0.5 ? from : to`) picks `to` — the older scene of the pair — when `mix` lands
 * exactly on `0.5`; this reproduces that tie-break without needing `sceneAt`/`dominantScene`
 * (or `Scene` identity) at query time. `undefined` for an empty `territories` — nothing to floor.
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
 * `steadyPacing`, wrapped with the two re-review fixes `Experience.tsx`'s playback loop needs
 * every frame (2026-09-15):
 *
 * - **Evaluated at `renderedT`**, the `t` this frame actually commits and renders (i.e.
 *   `advanceSteadyPlayhead`'s own return value), not the `t` playback started the frame at.
 *   Reading the pre-advance `t` left the regime one frame stale relative to what `SceneView` and
 *   the once-mode sound trigger actually see: on the one frame `t` crosses from a comfortably-
 *   paced territory into a dense `'cut'` one, the stale read still said `'crossfade'`, so a once-
 *   mode sound landing exactly on that boundary could fire even though the frame it fired on was
 *   already rendering the hard-cut territory (confirmed: `kpg-arrival`/`first-powered-flight`).
 * - **`seeked`**: `true` for a frame whose *starting* `t` was not the previous frame's own
 *   `advanceSteadyPlayhead` output — a scrub, a checkpoint/event jump, a keyboard step, or any
 *   other direct `setT` between the two — forces `'crossfade'`/not-floored regardless of what the
 *   landed-on territory would otherwise imply, exactly reproducing pre-ADR-029 scrub/seek
 *   behaviour (`Experience.tsx`'s own doc comment: "keep the existing dissolve rate limit for
 *   scrubs and seeks"). Without this, steady playback continuing to hard-cut through whatever
 *   territory a drag or a keyboard step happened to land in showed up live as up to 10 image
 *   changes a second while dragging — this function is what keeps that always reading as the
 *   ordinary rate-limited crossfade instead, letting `presentation.ts`'s own `MIN_TRANSITION_SECONDS`
 *   floor (never this file's `MIN_CUT_DWELL_SECONDS` one) govern it, the same as before this ADR.
 *
 * Pure in its five inputs — `seeked` is the caller's own comparison against whatever it tracked
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
