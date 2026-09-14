/**
 * Focus + context distortion for the main scrub track: while the pointer is over it, the track
 * stretches around the pointer so nearby events, pips and ticks spread apart, and the rest of
 * the track compresses uniformly toward both ends. Anything outside the lens keeps its place
 * as the lens moves — only what passes through the lens moves.
 *
 * The distortion is a density over the undistorted track's own 0..1 space (`s`):
 *
 *   density(s) = 1 + (extra mass, allocated between a smooth bump and gap insertions)
 *
 * ## Mass conservation
 *
 * The *total* extra mass `density` may add, integrated over the whole `[0, 1]` track, is a
 * fixed **budget** `B = gain · halfWidth` (`gain = FISHEYE_GAIN · strength`, `halfWidth =
 * FISHEYE_HALF_WIDTH_PX` in track-fraction units) — exactly the mass a full, unclipped raised
 * cosine of that gain and half-width would carry (a raised cosine's own average density over its
 * support is 1/2, so its integral over a `2·halfWidth`-wide span is `gain · halfWidth`; see
 * `bumpIntegral`). `B` is a pure function of `strength` and `trackWidthPx` — **never** of the
 * lens focus or of `markers` — so `density`'s total integral is always exactly `1 + B`, a
 * constant. That constant is what a displayed position is normalised against (`FisheyeTable.total`
 * below), so for any point `p` the lens's *local support* doesn't reach, `toUnit(p)` reduces to
 * either `p / (1 + B)` (p short of the support) or `(p + B) / (1 + B)` (p past all of it) — the
 * same formula regardless of where the focus sits or how `markers` is laid out, because `B`
 * doesn't change and nothing before/after the support adds or removes mass. This is not just a
 * design goal but a provable consequence of the budget being focus-independent: `fisheye.test.ts`
 * pins it down directly (a point outside two different lenses' supports gets bit-for-bit, not
 * just approximately, the same `toUnit`). An earlier version instead let gap insertion *add* to
 * the plain bump's own (focus/edge-dependent) mass, so the total — and therefore every point's
 * normalised position, including ones nowhere near the lens — shifted as the lens moved between
 * sparse and dense regions: a verified defect, since fixed by capping the *total* at a constant
 * `B` and reallocating rather than adding (below).
 *
 * **Edge clipping.** Near either domain edge the raised-cosine bump's own natural support runs
 * past `[0, 1]`, so its *in-domain* integral (`bumpIntegral(bump, 1) - bumpIntegral(bump, 0)`,
 * the "clipped unit mass") is less than the unclipped `halfWidth` it would otherwise carry — as
 * little as `halfWidth / 2` right at an edge (`focus = 0` or `1`, where the raised cosine is
 * symmetric about the edge itself). Rather than letting the budget shrink there (which would
 * revive the same focus-dependent-total problem `B` exists to avoid), the clipped-away share is
 * redistributed into the remaining in-domain portion: the bump's *effective* gain used for the
 * table (`allocateExtraMass`'s `bumpGain`) is scaled up so its in-domain integral still equals
 * whatever share of `B` the bump ends up with, however small that in-domain portion is. `B`
 * itself — computed straight from the unclipped `gain · halfWidth`, never from the clipped
 * integral — is unaffected by clipping either way.
 *
 * ## Density-adaptive gap insertion
 *
 * `markers` is a sorted list of undistorted (`s`-space) positions; positions within
 * `MARKER_DEDUPE_EPSILON` of each other are true duplicates and collapse to one (that dedup is
 * for the lens only — a cluster list built from the same events still shows every member).
 * Every remaining adjacent pair narrower than `MIN_MARKER_SEPARATION_PX` *base* px is a
 * candidate gap, weighted by `gapTaper` — the same raised-cosine shape as the plain bump,
 * evaluated at the gap's midpoint, but over its own wider support (`GAP_TAPER_HALF_WIDTH_PX`) so
 * a gap starts opening before the focus is squarely on it and finishes closing only once the
 * focus has properly moved on, rather than snapping at `bump`'s tighter radius.
 *
 * Because the *total* is now fixed at `1 + B` regardless of insertion, a gap's target mass no
 * longer needs the old "solve as if this gap existed alone against a growing total" derivation —
 * it is simply `targetU · (1 + B)`, `targetU = MIN_MARKER_SEPARATION_PX / trackWidthPx`, which
 * alone would occupy exactly `MIN_MARKER_SEPARATION_PX` displayed px of the (now-constant) total
 * track length. Gaps draw from the budget **first**: every candidate's tapered target is summed,
 * and if that combined demand exceeds `B`, every candidate is scaled down by the same factor —
 * continuous as gaps enter/leave the taper (no candidate ever "wins" outright at another's
 * expense in a way that pops as the focus moves) — capped at `B` exactly, a dense cluster can
 * consume the *entire* budget, in which case the smooth bump gets none of it right at the
 * cluster's centre (acceptable: the gaps are exactly where the magnification is needed).
 * Whatever of `B` the gaps don't claim is the *remainder* handed to the smooth bump (the edge
 * redistribution above). `GAP_TAPER_HALF_WIDTH_PX` decides which nearby gaps are *candidates* to
 * compete for this budget (narrowing it further was tried and rejected — see that constant's own
 * doc comment: near-present clusters sit close enough to the domain's own edge that a narrower
 * taper shifts where a hovering lens self-consistently settles enough to under-resolve a real
 * dense cluster) — but the fixed budget `B` is what actually bounds how much room gaps
 * collectively get and, transitively, exactly how far a point *outside* the whole local support
 * can ever be pushed: never at all, by the mass-conservation argument above, not merely "by a
 * small bounded amount" as an additive cap would only approximate.
 *
 * Both `toUnit` and `fromUnit` are evaluated off a small precomputed piecewise table
 * (`FisheyeTable`, built once per `fisheyeScale()` call) over the *effective* bump (gain
 * redistributed per "Edge clipping" above): its primitive is closed-form everywhere, so the only
 * per-call work is locating, by binary search over the (few, only-those-near-the-focus) active
 * gaps, which interval a query falls in — O(log n) — then either reading the closed form
 * directly (`toUnit`) or bisecting *within that one interval* (`fromUnit`). Bisecting within an
 * already-tiny bracket (a resolved marker gap is typically `~1e-10`–`~1e-2` wide in `s`, never
 * the whole `[0, 1]` track) reaches far higher absolute precision than the same iteration count
 * over the full track would — enough to resolve the K-Pg trio's ~0.01yr and ~100yr sub-gaps to
 * well under a minute (see fisheye.test.ts's round-trip tests).
 *
 * `magnificationAt(t)` reports `density(s) / L` (`L` the table's total, `1 + B` to floating
 * precision — see "Mass conservation") — it can be astronomically large at the centre of a fully
 * resolved sub-pixel gap (a `~1e-6` base-px gap opened to 10 displayed px is a ~1e7x local
 * stretch); it is always finite, since `L` is a fixed, positive constant.
 *
 * `yearsPerDisplayedPixelAt` is a separate pure helper (not part of `FisheyeScale` — it takes
 * any scale with a `fromUnit`) answering "how many years does one displayed px span here",
 * for a caller that wants to size a time readout's precision; it does not itself format
 * anything.
 *
 * A lens glued to the pointer would make pointing *less* precise than no lens at all (content
 * under a moving lens slides past the pointer at the magnification rate), so the lens centre
 * lags the pointer near the focus and only tracks it 1:1 once the pointer has moved a deliberate
 * distance away (`moveFisheyeLens`). Earlier this was a dead zone (the lens holds still, then
 * eases to catch up *over time* once the pointer clears it) — re-centring on a timer, rather
 * than on the pointer's own motion, could move the lens (and so the time under a now-*stationary*
 * pointer) well after the gesture that triggered it, reading as a sudden unprompted jump. The
 * lens now moves only in direct response to pointer movement — a still pointer leaves it exactly
 * where it is, no matter how much time passes — via a coupling that rises smoothly from 0 at the
 * centre to 1 at `FISHEYE_COUPLING_RADIUS_PX`, so small movements near the focus barely move the
 * lens (precise aiming) and a deliberate move far enough away drags it along 1:1 (moving to a new
 * area), with no discontinuity in between.
 *
 * `focusForCentre` (`centreU` displayed ↔ `focus` undistorted) is deliberately **not**
 * reformulated to account for gap insertion or edge-mass redistribution: it still solves for
 * `focus` against the original, unadjusted plain bump alone, exactly as before, so its existing
 * monotonicity proof carries over unchanged. This is safe because the property that actually
 * matters for the lens ("the point that maps to `centreU` maps back to `centreU`") is
 * structural, not dependent on how `focus` is chosen — `fromUnit` and `toUnit` are built from
 * the *same* final table, so they are exact inverses of each other by construction regardless of
 * how the budget ends up allocated. `focus` only decides where the bump's own peak sits and
 * which gaps taper's `gapTaper` weights against; `allocateExtraMass` then redistributes the
 * fixed budget `B` around that one point.
 */

import type { GeoTime, TimeScale } from '@/types/layer'

import { clampUnit } from './util'

/** Half-width of the stretched region, in undistorted track pixels. */
export const FISHEYE_HALF_WIDTH_PX = 60

/** Extra density at the lens centre when the full mass-conserving budget (`gain · halfWidth`,
 *  see the module doc's "Mass conservation") goes entirely to the smooth bump — i.e. away from
 *  any marker gap. Peak magnification is then `(1 + gain) / (1 + B)`, about 5x on a typical
 *  1440px-wide track; a gap competing for the same budget lowers the bump's own local share
 *  (`allocateExtraMass`'s `bumpGain`) below `gain`, in exchange for resolving the gap itself. */
export const FISHEYE_GAIN = 5

/** Radius (displayed px) over which the lens centre's coupling to the pointer ramps from 0 (at
 *  the centre) to 1 (fully tracking): see `couplingFactor`. */
export const FISHEYE_COUPLING_RADIUS_PX = 48

/** A marker gap narrower than this (in *base*, undistorted px) is a candidate for density
 *  insertion — see the module doc's "Density-adaptive gap insertion". */
export const MIN_MARKER_SEPARATION_PX = 10

/** How far (displayed px, converted to `s`-space the same way `FISHEYE_HALF_WIDTH_PX` is) a
 *  gap's own raised-cosine taper reaches — wider than the plain bump's 60px so insertion opens
 *  and closes over a more gradual approach than the plain lens itself does. Narrowing this
 *  further (tried: a small multiple of `FISHEYE_HALF_WIDTH_PX`) was evaluated and rejected: it
 *  shifts where a lens hovering a near-present dense cluster self-consistently settles (the
 *  bisection `centreUForFocus`-style callers use to place the lens on a target), and near-present
 *  clusters sit close enough to the domain's own edge (`s ≈ 1`) that the plain bump's own
 *  half-width is itself asymmetrically clipped there — a small shift in *where* the lens settles
 *  swings how much of the budget clipping leaves for the bump enough to under-resolve a
 *  genuinely dense real cluster (`fisheye.test.ts`'s "dense modern cluster" case, ~20 events
 *  within 150 years of the present) below its own `MIN_MARKER_SEPARATION_PX` target. The fixed
 *  mass budget `B` (module doc, "Mass conservation") is what actually bounds how far a hover can
 *  reflow content outside the lens — regardless of how wide a net this taper casts for
 *  *candidates* — so narrowing this constant further is not needed for that bound to hold. */
export const GAP_TAPER_HALF_WIDTH_PX = 240

/** Positions closer than this in `s`-space are true duplicates for the lens's own purposes
 *  (the same instant contributed twice, e.g. a point event's `tMin` === `tMax`) and collapse
 *  to one marker before gaps are built — far below the smallest *real* gap this package
 *  produces (the K-Pg trio's tightest pair is `~1e-10` in `s`), so nothing genuine merges. */
const MARKER_DEDUPE_EPSILON = 1e-12

const STRENGTH_TIME_CONSTANT_S = 0.12
const SETTLE_STRENGTH = 0.002
const BISECTION_ITERATIONS = 48

/** Coupling-integration step size (displayed px) — small enough that the result of a move does
 *  not depend on how many pointer events it arrived as (see `advanceLensCentre`). */
const MAX_SUBSTEP_PX = 1

export interface FisheyeScale extends TimeScale {
  /** Local stretch at `t`: displayed px per undistorted px (exactly 1 with no lens; can be
   *  astronomically large at the centre of a fully resolved sub-pixel gap — always finite). */
  magnificationAt(t: GeoTime): number
}

/** `centreU` is in *displayed* track units — the point that stays under the pointer.
 *  `strength` is 0 (no distortion) to 1 (full lens). */
export interface FisheyeLens {
  centreU: number
  strength: number
}

export interface FisheyeMotion {
  lens: FisheyeLens
}

export const RESTING_FISHEYE: FisheyeMotion = { lens: { centreU: 0.5, strength: 0 } }

interface Bump {
  focus: number
  halfWidth: number
  gain: number
}

function bumpDensity(bump: Bump, s: number): number {
  const x = s - bump.focus
  if (Math.abs(x) >= bump.halfWidth) return 0
  return (1 + Math.cos((Math.PI * x) / bump.halfWidth)) / 2
}

/** `∫ bumpDensity` from -∞ to `s`. */
function bumpIntegral(bump: Bump, s: number): number {
  const x = s - bump.focus
  if (x <= -bump.halfWidth) return 0
  if (x >= bump.halfWidth) return bump.halfWidth
  return (x + bump.halfWidth + (bump.halfWidth / Math.PI) * Math.sin((Math.PI * x) / bump.halfWidth)) / 2
}

/** Closed-form cumulative integral of the *plain* bump density alone (no gap insertion) —
 *  used by `focusForCentre` (which must stay independent of `markers`, see module doc) and as
 *  the per-interval closed form `FisheyeTable` builds on top of. */
function primitive(bump: Bump, s: number): number {
  return s + bump.gain * bumpIntegral(bump, s)
}

/** Total raw length of the *original, unadjusted* plain bump alone over `[0, 1]` — used only by
 *  `distort`/`focusForCentre`'s own self-contained bisection (module doc: deliberately not
 *  gap-aware or edge-redistribution-aware). This is **not** the scale's actual total mass any
 *  more — that is `FisheyeTable.total`, built from the *effective* (redistributed) bump; see
 *  `allocateExtraMass`. */
function normaliser(bump: Bump): number {
  return primitive(bump, 1) - primitive(bump, 0)
}

function distort(bump: Bump, s: number): number {
  return (primitive(bump, s) - primitive(bump, 0)) / normaliser(bump)
}

/** Bisection over a strictly increasing `f` on `[lo, hi]`. Used both for the plain-bump-only
 *  `focusForCentre` solve (`lo, hi = 0, 1`) and, bounded to one `FisheyeTable` interval, for
 *  `fromUnit` — bisecting within an already-narrow bracket (a resolved marker gap can be as
 *  little as `~1e-10` wide in `s`) reaches far higher absolute precision than the same
 *  iteration count over the whole `[0, 1]` track would need to for a target buried inside it. */
function invertOnBracket(f: (x: number) => number, lo: number, hi: number, target: number): number {
  let a = lo
  let b = hi
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (a + b) / 2
    if (f(mid) < target) a = mid
    else b = mid
  }
  return (a + b) / 2
}

/** The undistorted focus whose own displayed position is `centreU`, against the *plain* bump
 *  only (module doc: deliberately not gap-aware). `f -> distort(bump_f, f)` is strictly
 *  increasing in `f` (its derivative's numerator is `N + gain·bump_f(0)·(N - P)` with
 *  normaliser `N` exceeding the partial integral `P`), so bisection always converges. */
function focusForCentre(centreU: number, halfWidth: number, gain: number): number {
  return invertOnBracket((focus) => distort({ focus, halfWidth, gain }, focus), 0, 1, clampUnit(centreU))
}

// ---------------------------------------------------------------------------------------------
// Density-adaptive gap insertion
// ---------------------------------------------------------------------------------------------

interface GapInsertion {
  /** Base (undistorted) start/end, `s`-space — always a real, distinct marker pair. */
  start: number
  end: number
  /** Extra integral mass given to this gap, after taper weighting and the total-insertion cap
   *  have both been applied. Uniform density within `[start, end]` is `mass / (end - start)`. */
  mass: number
}

/** Dedupes `markers` (sorted ascending on return) per `MARKER_DEDUPE_EPSILON`. */
function dedupeMarkers(markers: readonly number[]): number[] {
  const sorted = [...markers].map(clampUnit).sort((a, b) => a - b)
  const unique: number[] = []
  for (const m of sorted) {
    if (unique.length === 0 || m - unique[unique.length - 1]! > MARKER_DEDUPE_EPSILON) unique.push(m)
  }
  return unique
}

/** How strongly a gap centred at `gapMid` is "near" `focus`, 0..1 and zero beyond
 *  `taperHalfWidth` — the same raised-cosine shape as the plain bump (`bumpDensity`), just
 *  reused over its own, wider support, so insertion opens/closes continuously rather than
 *  popping in at a hard threshold. */
function gapTaper(focus: number, taperHalfWidth: number, gapMid: number): number {
  return bumpDensity({ focus, halfWidth: taperHalfWidth, gain: 1 }, gapMid)
}

/** The fixed extra-mass budget `B` (module doc, "Mass conservation") — the mass an unclipped
 *  raised cosine of `bump`'s own `gain` and `halfWidth` would carry over its full, natural
 *  support. Depends only on `bump.gain` and `bump.halfWidth` — **not** on `bump.focus` — so it
 *  is the same value regardless of where the lens is pointed. */
function extraMassBudget(bump: Bump): number {
  return bump.gain * bump.halfWidth
}

/** The bump's own raw (gain-independent) integral over `[0, 1]` — how much of its natural
 *  support actually lies inside the domain. Equals `bump.halfWidth` when the bump isn't clipped
 *  by either domain edge; as little as `bump.halfWidth / 2` right at an edge. Always positive for
 *  `focus ∈ [0, 1]`, `halfWidth > 0`. */
function clippedBumpUnitMass(bump: Bump): number {
  return bumpIntegral(bump, 1) - bumpIntegral(bump, 0)
}

interface ExtraMassAllocation {
  /** Gap insertions, masses already scaled to fit the budget. */
  gaps: GapInsertion[]
  /** Effective gain for the smooth bump component — `bumpGain * clippedBumpUnitMass(bump)`
   *  equals whatever of the budget the gaps didn't claim (the module doc's "Edge clipping"
   *  redistribution folds in automatically: a smaller in-domain unit mass needs a
   *  proportionally larger gain to carry the same in-domain mass). */
  bumpGain: number
}

/**
 * Allocates the fixed budget `B = extraMassBudget(bump)` between marker-gap insertions and the
 * smooth bump, so the *combined* extra mass is always exactly `B` — never more, regardless of
 * `markers` or how close `bump.focus` sits to a domain edge (module doc, "Mass conservation").
 *
 * Gaps draw from `B` first. Every adjacent marker pair narrower than `MIN_MARKER_SEPARATION_PX`
 * *base* px and within `gapTaper`'s nonzero range of `bump.focus` is a candidate; its untapered
 * target, `targetU * (1 + B)` (`targetU = MIN_MARKER_SEPARATION_PX / trackWidthPx`), is exactly
 * the mass that alone would occupy `MIN_MARKER_SEPARATION_PX` displayed px of the *fixed* total
 * `1 + B` — no longer the old "solve for a mass that grows the total" derivation, because the
 * total no longer grows. Weighted by `taper` (0..1, full only when the gap sits squarely under
 * the focus), every candidate's tapered target is summed; if that demand exceeds `B`, every
 * candidate is scaled down by the same factor so a crowded neighbourhood shrinks together,
 * continuously, rather than some gaps winning outright at others' expense (which would pop as
 * the focus moved and the "winner" changed). A cluster dense enough to demand the *entire*
 * budget leaves nothing for the smooth bump at its centre — acceptable, and the point of
 * prioritising gaps: the magnification is needed exactly there.
 *
 * Whatever of `B` the gaps didn't claim goes to the bump: `bumpGain = (B - gapMassTotal) /
 * clippedBumpUnitMass(bump)`, so the bump's own in-domain integral is exactly that remainder —
 * this is also where edge clipping's redistribution happens, since a smaller in-domain unit mass
 * (near a domain edge) needs a proportionally larger gain to still carry the same share.
 */
function allocateExtraMass(bump: Bump, markers: readonly number[], trackWidthPx: number): ExtraMassAllocation {
  const budget = extraMassBudget(bump)
  const unitMass = clippedBumpUnitMass(bump)
  const bumpGainFor = (bumpMass: number): number => (unitMass > 0 ? bumpMass / unitMass : 0)

  const unique = dedupeMarkers(markers)
  if (unique.length < 2) return { gaps: [], bumpGain: bumpGainFor(budget) }

  const targetU = Math.min(MIN_MARKER_SEPARATION_PX / trackWidthPx, 0.4)
  const taperHalfWidth = GAP_TAPER_HALF_WIDTH_PX / trackWidthPx
  const perGapFullTarget = targetU * (1 + budget)

  const candidates: GapInsertion[] = []
  for (let i = 0; i < unique.length - 1; i++) {
    const start = unique[i]!
    const end = unique[i + 1]!
    if ((end - start) * trackWidthPx >= MIN_MARKER_SEPARATION_PX) continue
    const taper = gapTaper(bump.focus, taperHalfWidth, (start + end) / 2)
    if (taper <= 0) continue
    candidates.push({ start, end, mass: perGapFullTarget * taper })
  }
  if (candidates.length === 0) return { gaps: [], bumpGain: bumpGainFor(budget) }

  const demand = candidates.reduce((sum, g) => sum + g.mass, 0)
  const gapMassTotal = Math.min(demand, budget)
  const scaleFactor = demand > 0 ? gapMassTotal / demand : 0
  const gaps = candidates.map((g) => ({ ...g, mass: g.mass * scaleFactor }))

  return { gaps, bumpGain: bumpGainFor(budget - gapMassTotal) }
}

/** A small precomputed piecewise table over `[0, 1]`: sorted breakpoints (the plain bump's
 *  primitive is closed-form everywhere, so the only breakpoints needed are gap edges), the
 *  cumulative raw length at each, and which gap (if any) owns each interval. Built once per
 *  `fisheyeScale()` call; every `toUnit`/`fromUnit` query then locates its interval by binary
 *  search over this table — O(log n) in the (small, near-focus-only) active gap count. */
interface FisheyeTable {
  breaks: number[]
  rawAt: number[]
  gapAt: (GapInsertion | null)[]
  total: number
}

function buildFisheyeTable(bump: Bump, gaps: readonly GapInsertion[]): FisheyeTable {
  const breaks: number[] = [0]
  const gapAt: (GapInsertion | null)[] = []
  for (const gap of gaps) {
    if (gap.start > breaks[breaks.length - 1]!) {
      breaks.push(gap.start)
      gapAt.push(null)
    }
    breaks.push(gap.end)
    gapAt.push(gap)
  }
  if (breaks[breaks.length - 1]! < 1) {
    breaks.push(1)
    gapAt.push(null)
  }

  const rawAt: number[] = [0]
  let cumulative = 0
  for (let i = 0; i < gapAt.length; i++) {
    const lo = breaks[i]!
    const hi = breaks[i + 1]!
    cumulative += primitive(bump, hi) - primitive(bump, lo) + (gapAt[i]?.mass ?? 0)
    rawAt.push(cumulative)
  }
  return { breaks, rawAt, gapAt, total: cumulative }
}

/** Index `k` such that `s` falls in `[breaks[k], breaks[k+1]]` (the last interval owns `s = 1`
 *  too). Binary search — O(log n) in the breakpoint count. */
function intervalIndexFor(breaks: readonly number[], s: number): number {
  let lo = 0
  let hi = breaks.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (breaks[mid]! <= s) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Same search over `rawAt` instead of `breaks`, for locating which interval a raw-length
 *  target falls in before inverting within it. */
function intervalIndexForTarget(rawAt: readonly number[], target: number): number {
  let lo = 0
  let hi = rawAt.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (rawAt[mid]! <= target) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Cumulative raw (unnormalised) length from `0` to `s`, closed-form within whichever interval
 *  `s` falls in: the plain bump's own primitive, plus a linear ramp through the active gap's
 *  mass if there is one. */
function rawCumulativeAt(table: FisheyeTable, bump: Bump, s: number): number {
  const idx = intervalIndexFor(table.breaks, s)
  const lo = table.breaks[idx]!
  const base = table.rawAt[idx]! + (primitive(bump, s) - primitive(bump, lo))
  const gap = table.gapAt[idx]
  return gap ? base + gap.mass * ((s - gap.start) / (gap.end - gap.start)) : base
}

/** Raw (unnormalised) density at `s` — the plain bump's own density plus the active gap's
 *  uniform insertion rate, if any. `magnificationAt` divides this by `table.total`. */
function localDensity(bump: Bump, table: FisheyeTable, s: number): number {
  const idx = intervalIndexFor(table.breaks, s)
  const gap = table.gapAt[idx]
  const plain = 1 + bump.gain * bumpDensity(bump, s)
  return gap ? plain + gap.mass / (gap.end - gap.start) : plain
}

/**
 * `base` distorted by `lens` over a track `trackWidthPx` wide, with `markers` (sorted
 * undistorted, `s`-space positions — every scene `t` and event-range endpoint on the track;
 * the integrator builds this list) getting density-adaptive gap insertion out of the lens's
 * fixed mass budget (module doc, "Mass conservation"). With no lens (strength 0, or no measured
 * width) this is `base` itself with a flat magnification of 1, regardless of `markers`.
 * `markers` defaults to `[]`, which reduces to the plain bump (no gaps ever qualify with fewer
 * than two markers), redistributed for domain-edge clipping exactly as it would be with markers
 * present — identical to the pre-density-adaptive bump whenever the lens isn't clipped by a
 * domain edge — so existing call sites that don't pass it see no change away from the edges.
 */
export function fisheyeScale(
  base: TimeScale,
  lens: FisheyeLens,
  trackWidthPx: number,
  markers: readonly number[] = [],
): FisheyeScale {
  const strength = clampUnit(lens.strength)
  if (strength === 0 || !(trackWidthPx > 0)) {
    return { kind: base.kind, domain: base.domain, toUnit: base.toUnit, fromUnit: base.fromUnit, magnificationAt: () => 1 }
  }
  const halfWidth = FISHEYE_HALF_WIDTH_PX / trackWidthPx
  const gain = FISHEYE_GAIN * strength
  const focus = focusForCentre(lens.centreU, halfWidth, gain)
  const bump: Bump = { focus, halfWidth, gain }
  const { gaps, bumpGain } = allocateExtraMass(bump, markers, trackWidthPx)
  // The bump actually used for the table/density: its gain is the budget's remainder after gap
  // insertions, redistributed for any domain-edge clipping — see `allocateExtraMass` and the
  // module doc's "Mass conservation". `bump` itself (original, unadjusted gain) stays untouched,
  // used only by `focusForCentre` above and `gapTaper` inside `allocateExtraMass`.
  const effectiveBump: Bump = { focus, halfWidth, gain: bumpGain }
  const table = buildFisheyeTable(effectiveBump, gaps)

  const toUnit = (t: GeoTime): number => rawCumulativeAt(table, effectiveBump, base.toUnit(t)) / table.total

  const fromUnit = (u: number): GeoTime => {
    const target = clampUnit(u) * table.total
    const idx = intervalIndexForTarget(table.rawAt, target)
    const s = invertOnBracket((x) => rawCumulativeAt(table, effectiveBump, x), table.breaks[idx]!, table.breaks[idx + 1]!, target)
    return base.fromUnit(clampUnit(s))
  }

  return {
    kind: base.kind,
    domain: base.domain,
    toUnit,
    fromUnit,
    magnificationAt: (t: GeoTime): number => localDensity(effectiveBump, table, base.toUnit(t)) / table.total,
  }
}

/** Pure helper for a time readout that wants to size its own precision: years spanned by one
 *  displayed pixel at `u` on a `trackWidthPx`-wide track, via a symmetric finite difference
 *  through `scale.fromUnit`. Takes any scale with a `fromUnit` (the plain scale or a
 *  `FisheyeScale` alike) — formatting/precision decisions are the caller's; this only answers
 *  "how many years is one pixel here", which can be a fraction of a year inside a resolved
 *  gap or millions of years in a compressed stretch. */
export function yearsPerDisplayedPixelAt(scale: Pick<TimeScale, 'fromUnit'>, u: number, trackWidthPx: number): number {
  if (!(trackWidthPx > 0)) return NaN
  const halfPxU = 0.5 / trackWidthPx
  const lo = clampUnit(u - halfPxU)
  const hi = clampUnit(u + halfPxU)
  const spanU = hi - lo
  if (spanU <= 0) return 0
  return Math.abs(scale.fromUnit(hi) - scale.fromUnit(lo)) / (spanU * trackWidthPx)
}

function approach(value: number, target: number, dtSeconds: number, timeConstantSeconds: number): number {
  return target + (value - target) * Math.exp(-dtSeconds / timeConstantSeconds)
}

function approachStrength(value: number, target: number, dtSeconds: number): number {
  const next = approach(value, target, dtSeconds, STRENGTH_TIME_CONSTANT_S)
  return Math.abs(next - target) < SETTLE_STRENGTH ? target : next
}

/**
 * Advances `strength` by `dtSeconds` toward 1 (pointer present) or 0 (pointer gone) — the *only*
 * time-driven part of the lens. Pass `dtSeconds = Infinity` to jump straight to the target
 * (reduced motion). Never touches `centreU`: fading in/out never moves the lens, it only changes
 * how strongly the track is distorted around wherever the centre already is.
 */
export function stepFisheyeStrength(motion: FisheyeMotion, pointerPresent: boolean, dtSeconds: number): FisheyeMotion {
  const { centreU, strength } = motion.lens
  return { lens: { centreU, strength: approachStrength(strength, pointerPresent ? 1 : 0, dtSeconds) } }
}

/** Coupling between pointer movement and lens movement at `offsetPx` from the lens centre: 0 at
 *  the centre (the lens holds still — small, precise movements never perturb the magnified
 *  content) rising smoothly (smoothstep) to 1 at `FISHEYE_COUPLING_RADIUS_PX` (the lens tracks
 *  the pointer exactly — a deliberate move into a new area drags the lens straight along with
 *  it). Continuous and C¹ at both ends, so there is no kink in how fast the lens picks up. */
function couplingFactor(offsetPx: number): number {
  const x = clampUnit(offsetPx / FISHEYE_COUPLING_RADIUS_PX)
  return x * x * (3 - 2 * x)
}

/** Moves `centreU` for a pointer move from `fromU` to `toU` (displayed track units, on a
 *  `trackWidthPx`-wide track), integrating the coupling in `MAX_SUBSTEP_PX`-sized steps: at each
 *  substep the coupling is re-evaluated at the *current* offset before moving the centre by that
 *  fraction of the substep, so a move that crosses from inside the coupling radius to outside it
 *  smoothly speeds up rather than committing to one coupling factor for the whole move. Small
 *  enough substeps that splitting one long move into many shorter calls (a slow drag sampled
 *  every pointer event vs. the same drag sampled less often) lands the centre in the same place
 *  either way. Finishes by clamping the result to `FISHEYE_COUPLING_RADIUS_PX` of `toU`, in case
 *  a single move is itself larger than the radius. */
function advanceLensCentre(centreU: number, fromU: number, toU: number, trackWidthPx: number): number {
  const deltaU = toU - fromU
  if (deltaU === 0) return centreU
  const deltaPx = Math.abs(deltaU) * trackWidthPx
  const steps = Math.max(1, Math.ceil(deltaPx / MAX_SUBSTEP_PX))
  const stepU = deltaU / steps
  let pointer = fromU
  let centre = centreU
  for (let i = 0; i < steps; i++) {
    pointer += stepU
    const offsetPx = Math.abs(pointer - centre) * trackWidthPx
    centre += couplingFactor(offsetPx) * stepU
  }
  const offsetPx = Math.abs(toU - centre) * trackWidthPx
  if (offsetPx > FISHEYE_COUPLING_RADIUS_PX) {
    const radiusU = FISHEYE_COUPLING_RADIUS_PX / trackWidthPx
    centre = toU - Math.sign(toU - centre) * radiusU
  }
  return clampUnit(centre)
}

/**
 * Moves the lens in response to the pointer moving from `fromPointerU` to `toPointerU`
 * (displayed track units) — the *only* way `centreU` changes; nothing here depends on how much
 * time has passed. `fromPointerU` is `null` when there is no previous position to move from — the
 * pointer has just arrived, either because the lens had fully faded out since it was last seen,
 * or because it left and came straight back while still visible (a quick leave/re-enter of the
 * track; `strength` hasn't had time to fade).
 *
 * Only the fully-faded case reappears the lens directly under the pointer: with `strength` at or
 * below `SETTLE_STRENGTH` there is nothing on screen to jump, so snapping is unobservable and
 * exactly what "reappearing" should mean. While the lens is still visible, snapping there would
 * be a real, sudden jump, so re-entry is instead treated as an ordinary coupled move — as if the
 * pointer had last been exactly at the lens centre (zero offset, so barely coupled) and swept
 * from there to `toPointerU`, landing within `advanceLensCentre`'s usual coupling-radius clamp of
 * it. Same continuous, radius-bounded motion as any other move; the only special case is which
 * position stands in for the pointer's unknown last whereabouts.
 */
export function moveFisheyeLens(
  motion: FisheyeMotion,
  fromPointerU: number | null,
  toPointerU: number,
  trackWidthPx: number,
): FisheyeMotion {
  const toU = clampUnit(toPointerU)
  const { centreU, strength } = motion.lens
  if (!(trackWidthPx > 0)) {
    return { lens: { centreU: toU, strength } }
  }
  if (fromPointerU === null && strength <= SETTLE_STRENGTH) {
    return { lens: { centreU: toU, strength } }
  }
  const fromU = fromPointerU === null ? centreU : clampUnit(fromPointerU)
  return { lens: { centreU: advanceLensCentre(centreU, fromU, toU, trackWidthPx), strength } }
}

/** Whether another `stepFisheyeStrength` call would change nothing — the animation loop can
 *  stop. (`moveFisheyeLens` never needs a loop: it runs once per pointer event, not per frame.) */
export function isFisheyeSettled(motion: FisheyeMotion, pointerPresent: boolean): boolean {
  return motion.lens.strength === (pointerPresent ? 1 : 0)
}
