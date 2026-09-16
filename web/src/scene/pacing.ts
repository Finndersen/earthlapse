/**
 * Playback pacing for `'scenes'` mode (ADR-016, superseding ADR-012's hybrid): the wall-clock
 * durations `advancePlayhead` (timeline package) spends crossing each scene and each dissolve,
 * so the picture stays a pure function of `t` during playback while still reading as settled
 * scenes joined by deliberate dissolves rather than a blur.
 *
 * Pacing the *playhead* rather than the presented mix keeps `sceneAt(scenes, t)` and every
 * other `t`-driven readout (time, era, ancestor, CO2) in lockstep: nothing here touches
 * presentation, only how fast `t` itself is allowed to move.
 *
 * `scenePlaybackSegments` computes, once per manifest, the ranges of `t` that a `'scenes'`-mode
 * `advancePlayhead` spends exactly a fixed number of wall-clock seconds at 1x crossing: the
 * held part of each scene (`SCENE_DWELL_SECONDS` plus a per-gap bonus, split across its two
 * neighbouring gaps) and the dissolve band between two scenes (`MIN_TRANSITION_SECONDS` — the
 * same constant `presentation.ts` uses as its rate-limit floor, so a paced playhead and the
 * rate limiter agree on how long a dissolve takes). Unlike ADR-012, this is an exact duration,
 * not a floor: `advancePlayhead` no longer caps a segment's velocity against `baseRate`, so a
 * sparse gap simply moves faster than the flat rate for its `durationSeconds` rather than
 * being left at `baseRate` because it was already wide enough. `advancePlayhead` is the only
 * consumer; it treats these as a structural `{ tNewer, tOlder, durationSeconds }[]` so the
 * `timeline` package need not import `scene`.
 *
 * `'steady'` mode ignores this file entirely — `advancePlayhead` only walks `scenesPacing` in
 * `'scenes'` mode.
 */

import { EARTH_FORMATION, type GeoTime } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { MIN_TRANSITION_SECONDS } from './presentation'
import { DISSOLVE_WIDTH, tAtLogP } from './scene'

/**
 * Total seconds a single scene dwells on screen, held clear of any dissolve, at 1x — split
 * evenly across its two neighbouring gaps (1.5 s of the hold before it, 1.5 s after), before
 * either gap's `gapBonusSeconds` is added. The newest and oldest scene each have only one
 * neighbouring gap, so only get the one half: "the oldest/newest scene's outer half simply
 * doesn't exist" is not a special case in the code, it falls out of there being no gap to emit
 * it into.
 */
export const SCENE_DWELL_SECONDS = 3.0

/**
 * Mirrors `timeline/scale.ts`'s `SYMLOG_C` by value (kept in sync by hand, not by importing
 * `@/timeline`) — this package stays self-contained in its own `t` math, the same reason this
 * file uses `scene.ts`'s `tAtLogP` (plain log1p, no `TimeScale`) rather than reaching for one.
 * Only the *relative* shape of the warp matters here (how much of the full domain's symlog range
 * a gap occupies), so a drift between the two constants would only mis-tune `gapBonusSeconds`'s
 * ramp, never break correctness or round-tripping.
 */
const SYMLOG_C = 1e4

function symlogU(t: GeoTime): number {
  return Math.log1p(t / SYMLOG_C)
}

/** `symlogU(EARTH_FORMATION)`, the full domain's own warped span — dividing by it turns
 *  `symlogU`'s absolute units into the same normalised 0..1 "how much of the whole timeline"
 *  fraction `TimeScale.toUnit` would report over `[0, EARTH_FORMATION]`. */
const FULL_DOMAIN_SYMLOG_SPAN = symlogU(EARTH_FORMATION)

/** How much of the full 4.6 Gyr domain's symlog range, 0..1, the gap between two adjacent
 *  scenes occupies — what `gapBonusSeconds` ramps on. */
function fullDomainSymlogUSpan(a: GeoTime, b: GeoTime): number {
  return Math.abs(symlogU(b) - symlogU(a)) / FULL_DOMAIN_SYMLOG_SPAN
}

/** The most a gap's two hold segments gain, combined, on top of the ordinary
 *  `SCENE_DWELL_SECONDS`, for spanning a lot of the timeline (ADR-016) — never added to the
 *  dissolve band, which stays exactly `MIN_TRANSITION_SECONDS` regardless of the gap's span. */
export const MAX_GAP_BONUS_SECONDS = 2.0

/**
 * Where the bonus ramp saturates, in full-domain symlog `u`. Calibrated against the current
 * `data/scenes.yaml` (40 scenes): the widest gap (`ice-age-europe-neanderthal` at 42 ka to
 * `acheulean-erectus` at 1.76 Ma, ~0.27 of the full domain's symlog span) fully saturates the
 * bonus; the next two (`c4-savanna-hipparion` -> `miocene-grassland`, ~0.072, and
 * `boring-billion-shallows` -> `great-oxidation`, ~0.064) land around 90% and 80% of it; the
 * rest of the deck (median gap ~0.011) stays a small, proportionate fraction. Revisit alongside
 * `SCENE_DWELL_SECONDS` whenever the scene count changes materially (ADR-014's note under
 * ADR-012 applies here too).
 */
const GAP_BONUS_SATURATION_U = 0.15

/**
 * A saturating ramp: rises in direct proportion to a gap's `fullDomainSymlogUSpan` for a small
 * gap, then flattens at `MAX_GAP_BONUS_SECONDS` once that span reaches
 * `GAP_BONUS_SATURATION_U` — so a handful of genuinely vast gaps read as slightly longer
 * without the bonus dominating pacing or growing unboundedly for the very largest ones.
 */
function gapBonusSeconds(a: GeoTime, b: GeoTime): number {
  return MAX_GAP_BONUS_SECONDS * Math.min(1, fullDomainSymlogUSpan(a, b) / GAP_BONUS_SATURATION_U)
}

/**
 * A stretch of `t` that a `'scenes'`-mode `advancePlayhead` spends exactly `durationSeconds`
 * of wall-clock time crossing at 1x (`playback.speed === 1`); faster speeds divide
 * `durationSeconds` down proportionally. Always `tNewer <= tOlder` (smaller `GeoTime` is nearer
 * the present, per the package convention).
 */
export interface PlaybackSegment {
  tNewer: GeoTime
  tOlder: GeoTime
  durationSeconds: number
}

/**
 * The paced segments spanning `[scenes[0].t, scenes[last].t]` exactly, contiguous and
 * ordered from newest to oldest. Each consecutive pair of scenes `a` (newer), `b` (older)
 * contributes three: `a`'s held half nearest this gap, the `DISSOLVE_WIDTH` dissolve band
 * centred on the gap's log1p midpoint (matching `sceneAt` exactly — the band's edges are the
 * same `t` values at which `sceneAt`'s mix reaches exactly 0 and exactly 1), and `b`'s held
 * half nearest this gap. Each held half is `SCENE_DWELL_SECONDS / 2` plus half of the gap's
 * `gapBonusSeconds` — the bonus, like the base dwell, splits evenly across the gap's two
 * neighbouring holds. Returns `[]` for zero or one scenes — there is no gap to pace.
 */
export function scenePlaybackSegments(scenes: readonly Scene[]): PlaybackSegment[] {
  const segments: PlaybackSegment[] = []
  const halfWidth = DISSOLVE_WIDTH / 2
  const halfDwell = SCENE_DWELL_SECONDS / 2

  for (let i = 0; i < scenes.length - 1; i++) {
    const a = scenes[i]!
    const b = scenes[i + 1]!
    const bandNewerEdge = tAtLogP(a.t, b.t, 0.5 - halfWidth)
    const bandOlderEdge = tAtLogP(a.t, b.t, 0.5 + halfWidth)
    const holdSeconds = halfDwell + gapBonusSeconds(a.t, b.t) / 2

    segments.push({ tNewer: a.t, tOlder: bandNewerEdge, durationSeconds: holdSeconds })
    segments.push({ tNewer: bandNewerEdge, tOlder: bandOlderEdge, durationSeconds: MIN_TRANSITION_SECONDS })
    segments.push({ tNewer: bandOlderEdge, tOlder: b.t, durationSeconds: holdSeconds })
  }

  return segments
}
