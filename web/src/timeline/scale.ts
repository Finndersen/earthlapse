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

function warpSymlog(t: GeoTime): number {
  return Math.log1p(t / SYMLOG_C)
}

function unwarpSymlog(w: number): GeoTime {
  return SYMLOG_C * Math.expm1(w)
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
export function createSymlogScale(window: TimeWindow): TimeScale {
  return buildScale('symlog', window, warpSymlog, unwarpSymlog)
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
