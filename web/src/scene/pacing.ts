/**
 * Playback pacing for `'scenes'` mode (ADR-016): wall-clock durations `advancePlayhead`
 * (timeline package) spends crossing each scene and each dissolve, so the picture stays a pure
 * function of `t` during playback while still reading as settled scenes joined by deliberate
 * dissolves rather than a blur.
 *
 * Pacing the *playhead* rather than the presented mix keeps `sceneAt(scenes, t)` and every
 * other `t`-driven readout (time, era, ancestor, CO2) in lockstep: nothing here touches
 * presentation, only how fast `t` is allowed to move.
 *
 * `scenePlaybackSegments` computes, once per manifest, the ranges of `t` a `'scenes'`-mode
 * `advancePlayhead` spends exactly a fixed number of wall-clock seconds at 1x crossing: the held
 * part of each scene (`SCENE_DWELL_SECONDS` plus a per-gap bonus, split across its two
 * neighbouring gaps) and the dissolve band between two scenes (`MIN_TRANSITION_SECONDS` — the
 * same constant `presentation.ts` uses as its rate-limit floor, so a paced playhead and the rate
 * limiter agree on dissolve duration). This is an exact duration, not a floor: `advancePlayhead`
 * does not cap a segment's velocity against `baseRate`, so a sparse gap moves faster than the
 * flat rate for its `durationSeconds`. `advancePlayhead` treats these as a structural
 * `{ tNewer, tOlder, durationSeconds }[]` so the `timeline` package need not import `scene`.
 *
 * `'steady'` mode ignores this file — `advancePlayhead` only walks `scenesPacing` in `'scenes'`
 * mode.
 *
 * `playbackSecondsBetween`/`yearsForPlaybackSeconds` convert between a stretch of `t` and the
 * wall-clock seconds `'scenes'`-mode playback spends crossing it — the tool a caller needs to
 * size something in *years of `t`* (a label's fade window, say) so its actual on-screen duration
 * stays constant, rather than in years directly, which the playhead does not move through at a
 * fixed rate.
 */

import { EARTH_FORMATION, type GeoTime } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { MIN_TRANSITION_SECONDS } from './presentation'
import { DISSOLVE_WIDTH, tAtLogP } from './scene'

/**
 * Total seconds a single scene dwells on screen, held clear of any dissolve, at 1x — split
 * evenly across its two neighbouring gaps (1.5 s before it, 1.5 s after), before either gap's
 * `gapBonusSeconds` is added. The newest and oldest scene each have only one neighbouring gap,
 * so only get the one half — no special case needed, it falls out of there being no gap to
 * emit the other half into.
 */
export const SCENE_DWELL_SECONDS = 3.0

/**
 * Mirrors `timeline/scale.ts`'s `SYMLOG_C` by value (kept in sync by hand, not by importing
 * `@/timeline`, so this package stays self-contained in its own `t` math). Only the *relative*
 * shape of the warp matters here (how much of the full domain's symlog range a gap occupies),
 * so a drift between the two constants would only mis-tune `gapBonusSeconds`'s ramp, never
 * break correctness or round-tripping.
 */
const SYMLOG_C = 1e4

function symlogU(t: GeoTime): number {
  return Math.log1p(t / SYMLOG_C)
}

/** `symlogU(EARTH_FORMATION)` — dividing by it turns `symlogU`'s absolute units into the same
 *  normalised 0..1 fraction `TimeScale.toUnit` reports over `[0, EARTH_FORMATION]`. */
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
 * `data/scenes.yaml`: the widest gap (~0.27 of the full domain's symlog span) fully saturates
 * the bonus, the next two (~0.072, ~0.064) land around 90% and 80% of it, and the rest of the
 * deck (median gap ~0.011) stays a small, proportionate fraction. Revisit alongside
 * `SCENE_DWELL_SECONDS` if the scene count changes materially (ADR-014).
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
 * The paced segments spanning `[scenes[0].t, scenes[last].t]` exactly, contiguous and ordered
 * newest to oldest. Each consecutive pair of scenes `a` (newer), `b` (older) contributes three:
 * `a`'s held half nearest this gap, the `DISSOLVE_WIDTH` dissolve band centred on the gap's
 * log1p midpoint (matching `sceneAt` exactly — the band's edges are the same `t` values at
 * which `sceneAt`'s mix reaches exactly 0 and exactly 1), and `b`'s held half nearest this gap.
 * Each held half is `SCENE_DWELL_SECONDS / 2` plus half of the gap's `gapBonusSeconds`. Returns
 * `[]` for zero or one scenes.
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

// -------------------------------------------------------------------------- seconds <-> years

/** `symlogU`'s inverse: recovers a `t` from its full-domain symlog `u`. */
function symlogUInverse(u: number): GeoTime {
  return SYMLOG_C * Math.expm1(u)
}

/**
 * `scenePlaybackSegments`'s own cumulative index (`GeoTime` boundaries, their symlog `u`, and
 * running `durationSeconds` totals), built once per distinct `segments` array and reused across
 * every `playbackSecondsBetween`/`yearsForPlaybackSeconds` call against it — `newCityLabels` calls
 * the resolver built on this once per candidate city per frame (up to 283), so a fresh O(n) walk
 * of the scene deck on every call would matter. `segments` is itself built once per scene list
 * (`Experience.tsx`'s own `useMemo`), so keying this cache on the array's identity is safe: the
 * same reference always means the same content.
 */
interface PacingIndex {
  /** Ascending `GeoTime`: `segments[0].tNewer`, then each segment's `tOlder` in turn. */
  tBoundaries: GeoTime[]
  /** `symlogU` of each entry in `tBoundaries`, same order — precomputed so proration never
   *  repeats a `log1p` per query. */
  uBoundaries: number[]
  /** Cumulative `durationSeconds` at each entry in `tBoundaries`, starting at 0. */
  cumulativeSeconds: number[]
}

const pacingIndexCache = new WeakMap<readonly PlaybackSegment[], PacingIndex>()

function pacingIndexFor(segments: readonly PlaybackSegment[]): PacingIndex {
  const cached = pacingIndexCache.get(segments)
  if (cached !== undefined) return cached

  const tBoundaries: GeoTime[] = segments.length > 0 ? [segments[0]!.tNewer] : []
  const cumulativeSeconds: number[] = [0]
  for (const segment of segments) {
    tBoundaries.push(segment.tOlder)
    cumulativeSeconds.push(cumulativeSeconds[cumulativeSeconds.length - 1]! + segment.durationSeconds)
  }
  const index: PacingIndex = { tBoundaries, uBoundaries: tBoundaries.map(symlogU), cumulativeSeconds }
  pacingIndexCache.set(segments, index)
  return index
}

/**
 * Cumulative wall-clock seconds, at 1x, that crossing from `segments`' own newest edge down to
 * `t` takes — clamped flat outside the segments' own domain (0 before it, the full total beyond
 * it), which is what gives `playbackSecondsBetween` and `yearsForPlaybackSeconds` their "outside
 * every segment contributes nothing" behaviour.
 *
 * Proration inside the segment containing `t` is by symlog `u` fraction, not by a linear fraction
 * of the `t` range: `timeline/playback.ts`'s `buildRatedUSegments` plays each segment back at a
 * constant *`u`* velocity, not a constant `t` velocity, so a linear-in-`t` proration would
 * mismeasure any hold segment spanning a wide `t` range.
 */
function secondsAtT(segments: readonly PlaybackSegment[], t: GeoTime): number {
  const { tBoundaries, uBoundaries, cumulativeSeconds } = pacingIndexFor(segments)
  const n = tBoundaries.length
  if (n === 0) return 0
  if (t <= tBoundaries[0]!) return 0
  if (t >= tBoundaries[n - 1]!) return cumulativeSeconds[n - 1]!

  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (tBoundaries[mid]! <= t) lo = mid
    else hi = mid
  }
  const uSpan = uBoundaries[hi]! - uBoundaries[lo]!
  const fraction = uSpan > 0 ? (symlogU(t) - uBoundaries[lo]!) / uSpan : 0
  return cumulativeSeconds[lo]! + fraction * (cumulativeSeconds[hi]! - cumulativeSeconds[lo]!)
}

/**
 * `secondsAtT`'s inverse: the `t` at which cumulative seconds first reaches `target`, within
 * `segments`' own domain — clamped to 0 (never `segments[0].tNewer`: `yearsForPlaybackSeconds`
 * relies on this bottoming out at the true `t` floor, not the segments' own nearest edge) for a
 * `target` at or below 0, and to the oldest boundary for one at or above the full total.
 */
function tAtCumulativeSeconds(segments: readonly PlaybackSegment[], target: number): GeoTime {
  const { tBoundaries, uBoundaries, cumulativeSeconds } = pacingIndexFor(segments)
  const n = tBoundaries.length
  if (n === 0 || target <= 0) return 0
  if (target >= cumulativeSeconds[n - 1]!) return tBoundaries[n - 1]!

  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cumulativeSeconds[mid]! <= target) lo = mid
    else hi = mid
  }
  const secondsSpan = cumulativeSeconds[hi]! - cumulativeSeconds[lo]!
  const fraction = secondsSpan > 0 ? (target - cumulativeSeconds[lo]!) / secondsSpan : 0
  return symlogUInverse(uBoundaries[lo]! + fraction * (uBoundaries[hi]! - uBoundaries[lo]!))
}

/**
 * Wall-clock seconds, at 1x, that `'scenes'`-mode `advancePlayhead` spends crossing `[tNewer,
 * tOlder]`. Any part of the range that falls outside every segment (before `segments[0].tNewer`,
 * after the oldest segment's `tOlder`) contributes nothing — this module has no access to
 * `playback.baseRate`, which is what actually paces `t` out there (`advancePlayhead`'s own doc
 * comment), so it isn't modelled here.
 */
export function playbackSecondsBetween(segments: readonly PlaybackSegment[], tNewer: GeoTime, tOlder: GeoTime): number {
  if (tNewer > tOlder) {
    throw new Error(`playbackSecondsBetween: tNewer (${tNewer}) must be <= tOlder (${tOlder})`)
  }
  return secondsAtT(segments, tOlder) - secondsAtT(segments, tNewer)
}

/**
 * The inverse of `playbackSecondsBetween`: walking forward in time (decreasing `t`) from
 * `tStart`, how many years does `'scenes'`-mode playback cross before spending `seconds` of
 * wall-clock time at 1x? This is what turns a fixed real-time budget (a label should stay legible
 * for about this long) into the `t`-window a `t`-only sampler like `cityLabelOpacityAt` needs.
 *
 * Clamped at `tStart` when the budget outruns what `segments` can account for before `t` bottoms
 * out at 0 — the walk cannot span more years than that. The same "outside every segment
 * contributes nothing" rule as `playbackSecondsBetween` applies past either edge of the segments'
 * own domain: past the oldest edge, the whole stretch above it is spent for free before the walk
 * starts drawing down `seconds` inside the domain; below the newest edge, none of `seconds` can
 * ever be spent, so the walk always bottoms out at 0.
 */
export function yearsForPlaybackSeconds(segments: readonly PlaybackSegment[], tStart: GeoTime, seconds: number): GeoTime {
  if (seconds < 0) {
    throw new Error(`yearsForPlaybackSeconds: seconds must be >= 0, got ${seconds}`)
  }
  const target = secondsAtT(segments, tStart) - seconds
  const tEnd = tAtCumulativeSeconds(segments, target)
  return tStart - tEnd
}
