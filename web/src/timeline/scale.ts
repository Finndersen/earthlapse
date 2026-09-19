/**
 * TimeScale implementations (DESIGN §3). See index.ts for the orientation contract shared
 * by every scale in this package.
 */

import type { GeoTime, ScaleKind, TimeScale } from '@/types/layer'

import { clamp, clampUnit } from './util'

/**
 * The visible slice of the timeline, always `[newest, oldest]` in years BP — the same shape
 * and ordering as `TimeScale.domain` and `Layer.timeDomain`. `newest <= oldest`, both within
 * `[0, EARTH_FORMATION]`.
 */
export type TimeWindow = readonly [newest: GeoTime, oldest: GeoTime]

/**
 * Symlog break-point, in years: `log(1 + t / SYMLOG_C)`. Below `SYMLOG_C` the warp is close
 * to linear; above it, close to logarithmic.
 *
 * Chosen as 10,000 years — the Holocene, i.e. "recorded/civilised history" — deliberately,
 * not tuned to taste: it is the largest break-point that still keeps the *entire* Holocene
 * inside the near-linear region, so agriculture, cities and writing occupy a legible band of
 * the axis even zoomed all the way out to the full 4.6 Gyr domain, rather than collapsing to
 * sub-pixel the way a `symlog(t)` with no break-point (or a much larger one) would.
 */
export const SYMLOG_C = 1e4

/**
 * ADR-024 amendment (follow-up pass item 7). `SYMLOG_C` alone is a fixed 10,000-year knee no
 * matter what window is being drawn: fine when that window is the full 4.6 Gyr domain (its
 * whole reason for being that value), but a knee ten times the Holocene's *own* span leaves
 * everything inside the Holocene — first farmers through the present — in the near-linear
 * region, i.e. drawn at close to its true proportion, which is exactly the "the labels are not
 * visible" complaint the sub-Holocene sections (early modern, industrial age, modern) hit: each
 * is a sliver of an already-small span.
 *
 * The fix generalises `SYMLOG_C`'s own reasoning one level at a time instead of hand-tuning a
 * second constant: within a window narrower than `KNEE_ADAPTIVE_SPAN_THRESHOLD`, the knee is
 * the window's own span divided by 1000, so whichever of *that* window's children sits nearest
 * its present edge gets the same kind of room `SYMLOG_C` gives the Holocene against the full
 * domain. The threshold is chosen so the two rules join with no discontinuity: it is exactly
 * `SYMLOG_C * 1000`, the span at which `span / 1000` first equals `SYMLOG_C` itself. Above it —
 * the full domain and every section down to the Neogene — nothing changes; `symlogKnee` returns
 * plain `SYMLOG_C`, byte-identical to this file before the amendment. Below it — the Quaternary
 * downward, and in particular every Holocene section and its own children — the knee shrinks
 * with the window, which is also exactly where a section's own scale (`useAnimatedScale`, the
 * `'steady'`-mode playback rate, `ticks.ts`'s near-linear check) is drawn from a window that
 * size, so the visible track, the ruler and steady-mode pacing all move together automatically.
 * What deliberately does *not* pick this up: the full-domain scale `Experience.tsx` keeps for
 * the HUD sparklines and `'scenes'`-mode pacing (ADR-024's own "stay full-domain on purpose"
 * list) — its window is always `[0, EARTH_FORMATION]`, always at
 * or above the threshold, so it is provably unaffected; likewise `scene/pacing.ts` and
 * `globe/effects/math.ts`, which each keep their own fixed `SYMLOG_C` copy for an unrelated,
 * always-full-domain purpose and were not touched.
 */
const KNEE_ADAPTIVE_SPAN_THRESHOLD = SYMLOG_C * 1000

/** Defensive floor only: the section tree's own tiling invariant (`assertChildrenTileParents`)
 *  already guarantees every real window has positive span, so this never engages in practice —
 *  it exists so a span of exactly 0 divides to a knee of 0 (which would make `t / knee`
 *  diverge) rather than propagating a `NaN`/`Infinity` into the scale. */
const MIN_SYMLOG_KNEE = 1

/** The symlog knee to warp `window` with — see the amendment note on `KNEE_ADAPTIVE_SPAN_THRESHOLD`
 *  above. Exported so `ticks.ts`'s near-linear check uses the exact same knee the scale it is
 *  classifying was actually built with. */
export function symlogKnee(window: TimeWindow): GeoTime {
  const span = window[1] - window[0]
  return span >= KNEE_ADAPTIVE_SPAN_THRESHOLD ? SYMLOG_C : Math.max(span / 1000, MIN_SYMLOG_KNEE)
}

function warpSymlog(t: GeoTime, knee: GeoTime): number {
  return Math.log1p(t / knee)
}

function unwarpSymlog(w: number, knee: GeoTime): GeoTime {
  return knee * Math.expm1(w)
}

function assertValidWindow(window: TimeWindow): void {
  const [newest, oldest] = window
  if (!Number.isFinite(newest) || !Number.isFinite(oldest)) {
    throw new Error(`TimeWindow must be finite, got [${newest}, ${oldest}]`)
  }
  if (newest > oldest) {
    throw new Error(`TimeWindow must be ordered [newest, oldest] with newest <= oldest, got [${newest}, ${oldest}]`)
  }
}

/**
 * `t -> u` and back for a window, given the window's warped span. Shared by
 * `createSymlogScale` and `createLinearScale` — both are "linear in some warp of `t`", they
 * just warp differently.
 */
function buildScale(kind: ScaleKind, window: TimeWindow, warp: (t: GeoTime) => number, unwarp: (w: number) => GeoTime): TimeScale {
  assertValidWindow(window)
  const [newest, oldest] = window
  const wNewest = warp(newest)
  const wOldest = warp(oldest)
  const span = wOldest - wNewest

  return {
    kind,
    domain: [newest, oldest],
    toUnit: (t: GeoTime): number => (span === 0 ? 0 : (wOldest - warp(t)) / span),
    fromUnit: (u: number): GeoTime => unwarp(wOldest - clampUnit(u) * span),
  }
}

/**
 * `log(1 + t / SYMLOG_C)` over `window`, with the near-present region close to linear. See
 * `SYMLOG_C` for why that break-point.
 */
/**
 * `knee` defaults to `symlogKnee(window)`, but a caller that knows more about what `window`
 * represents than a bare span can override it — `sections.ts`'s `sectionSymlogKnee` is the one
 * real case (re-review fix, 2026-09-15): `symlogKnee`'s adaptive shrink below
 * `KNEE_ADAPTIVE_SPAN_THRESHOLD` exists to give a window's *children* room near its present
 * edge, so it should only fire for a section that actually has children. Called on a **leaf**
 * section's own window (no children to make room for — every one of the Holocene's six, "Modern"
 * among them), the plain default badly over-compresses: "Modern" (0-111 years) shrinks to a knee
 * of `MIN_SYMLOG_KNEE` (1), so the last 10 years alone drew over half the track and steady-mode
 * pacing spent the same share of wall-clock time there. `sectionSymlogKnee` passes the fixed
 * `SYMLOG_C` instead for a leaf, which reads close to true-proportional across a span that small
 * — see that function's own doc comment for the full reasoning.
 */
export function createSymlogScale(window: TimeWindow, knee: GeoTime = symlogKnee(window)): TimeScale {
  return buildScale(
    'symlog',
    window,
    (t) => warpSymlog(t, knee),
    (w) => unwarpSymlog(w, knee),
  )
}

/**
 * True proportional mapping over `window`. Deliberately near-useless at full zoom-out — see
 * index.ts and DESIGN §3.
 */
export function createLinearScale(window: TimeWindow): TimeScale {
  return buildScale('linear', window, (t) => t, (w) => w)
}

const BISECTION_ITERATIONS = 64

/**
 * Inverts a monotonically *decreasing* `f: [lo, hi] -> [f(hi), f(lo)]` (the shape every
 * `TimeScale.toUnit` has, since `u` runs 0 at `oldest` to 1 at `newest`) by bisection.
 * `BISECTION_ITERATIONS` halves the search interval that many times, which reaches full
 * `double` precision for any span this package produces (up to the ~4.6e9-year full domain)
 * long before it runs out — each extra iteration is cheap, so there is no reason to tune it
 * down per call site.
 */
function invertMonotoneDecreasing(f: (t: GeoTime) => number, lo: GeoTime, hi: GeoTime, target: number): GeoTime {
  let a = lo
  let b = hi
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (a + b) / 2
    if (f(mid) > target) {
      a = mid
    } else {
      b = mid
    }
  }
  return (a + b) / 2
}

/**
 * Animates `a` (symlog) <-> `b` (linear) as `k` runs 0..1: `toUnit` is the convex combination
 * of the two, which stays monotone (a sum of two monotone-decreasing functions is
 * monotone-decreasing) and so always has a well-defined inverse. That inverse has no closed
 * form once both endpoints contribute, so `fromUnit` bisects numerically.
 *
 * `a` and `b` must share a domain — blending scales built from different windows is not
 * meaningful and the result would not round-trip.
 */
export function blendScales(a: TimeScale, b: TimeScale, k: number): TimeScale {
  if (a.domain[0] !== b.domain[0] || a.domain[1] !== b.domain[1]) {
    throw new Error(`blendScales: a and b must share a domain, got [${a.domain}] and [${b.domain}]`)
  }
  const kk = clampUnit(k)
  const [newest, oldest] = a.domain

  if (kk === 0) return a
  if (kk === 1) return b

  const toUnit = (t: GeoTime): number => (1 - kk) * a.toUnit(t) + kk * b.toUnit(t)

  return {
    kind: kk < 0.5 ? a.kind : b.kind,
    domain: a.domain,
    toUnit,
    fromUnit: (u: number): GeoTime => clamp(invertMonotoneDecreasing(toUnit, newest, oldest, clampUnit(u)), newest, oldest),
  }
}

/**
 * The window `k` of the way (0..1) from `from` to `to`, with each edge moving in space warped by
 * the fixed `SYMLOG_C` — not the adaptive, window-dependent knee `createSymlogScale` now uses
 * (the amendment above `KNEE_ADAPTIVE_SPAN_THRESHOLD`): the transition's own shape stays the
 * same regardless of which two sections it runs between, only the *resting* scale afterwards
 * adapts. This is how a section change animates (ADR-024). Going from the full 4.6 Gyr domain to
 * the Holocene then reads as a steady zoom. A blend linear in years would spend nearly the whole
 * animation at spans of billions of years. Both edges move monotonically along the same warp, so
 * the result stays ordered.
 */
export function interpolateWindow(from: TimeWindow, to: TimeWindow, k: number): TimeWindow {
  assertValidWindow(from)
  assertValidWindow(to)
  const kk = clampUnit(k)
  if (kk === 0) return from
  if (kk === 1) return to
  const warp = (t: GeoTime): number => warpSymlog(t, SYMLOG_C)
  const unwarp = (w: number): GeoTime => unwarpSymlog(w, SYMLOG_C)
  const edge = (a: GeoTime, b: GeoTime): GeoTime => unwarp(warp(a) + (warp(b) - warp(a)) * kk)
  const newest = edge(from[0], to[0])
  const oldest = edge(from[1], to[1])
  return [Math.min(newest, oldest), oldest]
}
