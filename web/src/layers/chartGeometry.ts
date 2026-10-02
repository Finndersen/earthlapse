/**
 * Pure geometry for the expanded layer chart (`components/LayerChart.tsx`): a time axis that maps
 * `t` to a unit position, a fitted value axis, and the layer resampled into gap-broken runs.
 *
 * The time axis is linear or logarithmic in years-before-present. A log axis gives each decade of
 * age the same width, so a record spanning hundreds of millions of years can show its deep-time
 * trend, the glacial cycles of the last few million years and the instrumental era side by side;
 * on a linear axis the last few centuries of such a record are a fraction of a pixel. Unit `0` is
 * the oldest edge and `1` the newest, so the plot reads left to right in playback order.
 */

import type { GeoTime, Layer, ScalarValue } from '@/types/layer'

export type TimeAxisKind = 'linear' | 'log'

export interface TimeAxis {
  kind: TimeAxisKind
  /** `[newest, oldest]`, as `Layer.timeDomain`. On a log axis `newest` is at least one year. */
  domain: readonly [GeoTime, GeoTime]
  toUnit: (t: GeoTime) => number
  fromUnit: (u: number) => GeoTime
  ticks: () => GeoTime[]
}

/** A log axis needs a positive near edge; a year is the finest age anything here resolves. */
const LOG_FLOOR_YEARS = 1

/** Above this oldest-to-newest ratio a linear axis squeezes the recent record out of sight. */
const LOG_DEFAULT_RATIO = 1e4

export function defaultTimeAxisKind(timeDomain: readonly [GeoTime, GeoTime]): TimeAxisKind {
  const [newest, oldest] = timeDomain
  return oldest / Math.max(newest, LOG_FLOOR_YEARS) > LOG_DEFAULT_RATIO ? 'log' : 'linear'
}

export function timeAxis(kind: TimeAxisKind, timeDomain: readonly [GeoTime, GeoTime]): TimeAxis {
  const [rawNewest, oldest] = timeDomain
  if (kind === 'linear') {
    const span = oldest - rawNewest || 1
    return {
      kind,
      domain: [rawNewest, oldest],
      toUnit: (t) => (oldest - t) / span,
      fromUnit: (u) => oldest - u * span,
      ticks: () => niceTicks(rawNewest, oldest, 5),
    }
  }
  const newest = Math.max(rawNewest, LOG_FLOOR_YEARS)
  const logOldest = Math.log10(oldest)
  const logSpan = logOldest - Math.log10(newest) || 1
  return {
    kind,
    domain: [newest, oldest],
    toUnit: (t) => (logOldest - Math.log10(Math.max(t, newest))) / logSpan,
    fromUnit: (u) => 10 ** (logOldest - u * logSpan),
    ticks: () => decadeTicks(newest, oldest),
  }
}

/** Powers of ten inside `[lo, hi]`, thinned to every other one when there are more than seven. */
function decadeTicks(lo: number, hi: number): GeoTime[] {
  const ticks: GeoTime[] = []
  for (let p = Math.ceil(Math.log10(lo)); p <= Math.floor(Math.log10(hi)); p++) ticks.push(10 ** p)
  return ticks.length > 7 ? ticks.filter((_, i) => (ticks.length - 1 - i) % 2 === 0) : ticks
}

/** Round-numbered ticks (1, 2 or 5 × a power of ten apart) covering `[lo, hi]`, about `count` of them. */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) return [lo]
  const rough = (hi - lo) / count
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((m) => m * magnitude).reduce((best, s) => (Math.abs(s - rough) < Math.abs(best - rough) ? s : best))
  const ticks: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)))
  return ticks
}

export interface ChartPoint {
  u: number
  t: GeoTime
  value: number
  lower: number | null
  upper: number | null
}

export interface ChartCurve {
  /** Gap-free runs; a declared gap (ADR-027) or a hole in the domain ends a run. */
  runs: ChartPoint[][]
  /** `[min, max]` of the plotted value axis, or `null` when the layer has nothing to plot. */
  valueRange: [number, number] | null
}

/** Headroom above and below the data so the trace never runs along the plot's edge. */
const VALUE_PAD_FRACTION = 0.06

/** One sample per unit step, `count + 1` in all, broken into runs wherever `sample` is null. */
export function sampleCurve(layer: Layer<ScalarValue>, axis: TimeAxis, count: number): ChartCurve {
  const runs: ChartPoint[][] = []
  let run: ChartPoint[] = []
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i <= count; i++) {
    const u = i / count
    const t = axis.fromUnit(u)
    const v = layer.sample(t)
    if (v === null) {
      if (run.length > 1) runs.push(run)
      run = []
      continue
    }
    const lower = v.bounds?.[0] ?? null
    const upper = v.bounds?.[1] ?? null
    run.push({ u, t, value: v.value, lower, upper })
    lo = Math.min(lo, v.value, lower ?? v.value)
    hi = Math.max(hi, v.value, upper ?? v.value)
  }
  if (run.length > 1) runs.push(run)
  return { runs, valueRange: Number.isFinite(lo) ? fitValueRange(lo, hi) : null }
}

/**
 * The data's extent plus headroom. A positive series whose minimum is under a quarter of its
 * maximum (a count growing from near nothing) keeps zero as its floor, so its growth reads as a
 * proportion; anything else (a temperature, a sea level) is fitted to its own range, so a few
 * degrees of change is not flattened against an arbitrary zero.
 */
export function fitValueRange(lo: number, hi: number): [number, number] {
  if (lo >= 0 && lo < hi / 4) return [0, hi * (1 + VALUE_PAD_FRACTION)]
  const pad = (hi - lo || Math.abs(hi) || 1) * VALUE_PAD_FRACTION
  return [lo - pad, hi + pad]
}

/** Splits a run at `t` into the part playback has reached (older than `t`) and the rest, sharing
 *  the boundary point so the two lines join without a gap. */
export function splitAtT(run: ChartPoint[], t: GeoTime): { reached: ChartPoint[]; ahead: ChartPoint[] } {
  const i = run.findIndex((p) => p.t < t)
  if (i === -1) return { reached: run, ahead: [] }
  if (i === 0) return { reached: [], ahead: run }
  return { reached: run.slice(0, i), ahead: run.slice(i - 1) }
}
