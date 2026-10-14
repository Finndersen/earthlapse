/**
 * Pure geometry for the expanded layer chart (`components/LayerChart.tsx`): a linear time axis
 * over the whole record or a recent window of it, a fitted value axis, and the layer resampled
 * into gap-broken runs. Unit `0` is the oldest edge and `1` the newest, so the plot reads left to
 * right in playback order.
 */

import { formatAge, formatCalendar } from '@/timeline'
import { calendarYearAt, HOLOCENE_BASE, yearsBeforePresent } from '@/timeline/epoch'
import type { GeoTime, Layer, ScalarValue } from '@/types/layer'

export interface TimeTick {
  t: GeoTime
  label: string
}

export interface TimeAxis {
  /** `[newest, oldest]`, as `Layer.timeDomain`. */
  domain: readonly [GeoTime, GeoTime]
  toUnit: (t: GeoTime) => number
  fromUnit: (u: number) => GeoTime
  /** Newest first. */
  ticks: () => TimeTick[]
}

/** The recent spans the chart can zoom to, in years before present: since the last glacial
 *  maximum, the Common Era, and the industrial era. On a whole-record axis these are a sliver. */
export const RECENT_WINDOWS = [25_000, 2_000, 200] as const

/** The recent windows worth offering for a record: those under half its span. */
export function recentWindowsFor(timeDomain: readonly [GeoTime, GeoTime]): number[] {
  const [newest, oldest] = timeDomain
  return RECENT_WINDOWS.filter((w) => w < (oldest - newest) / 2)
}

/** The windows a chart over `timeDomain` offers, and the one it opens on: the opening record's
 *  own span, offered beside the recent windows when it is under half the axis, so a short record
 *  opens filling the plot rather than as a sliver at the edge of a long one; else the whole axis. */
export function chartWindows(timeDomain: readonly [GeoTime, GeoTime], openingOldest: GeoTime): { windows: number[]; opening: number | null } {
  const [newest, oldest] = timeDomain
  const opening = openingOldest - newest < (oldest - newest) / 2 ? openingOldest : null
  const windows = new Set<number>(recentWindowsFor(timeDomain))
  if (opening !== null) windows.add(opening)
  return { windows: [...windows].sort((a, b) => b - a), opening }
}

/** The `[newest, oldest]` the chart plots: the whole record, or its last `window` years. */
export function windowDomain(timeDomain: readonly [GeoTime, GeoTime], window: number | null): [GeoTime, GeoTime] {
  const [newest, oldest] = timeDomain
  return window === null ? [newest, oldest] : [newest, Math.min(oldest, Math.max(window, newest + 1))]
}

export function timeAxis(timeDomain: readonly [GeoTime, GeoTime]): TimeAxis {
  const [newest, oldest] = timeDomain
  const span = oldest - newest || 1
  return {
    domain: [newest, oldest],
    toUnit: (t) => (oldest - t) / span,
    fromUnit: (u) => oldest - u * span,
    ticks: () => linearTicks(newest, oldest),
  }
}

/** Round calendar years for a span inside the Holocene (1850, 1900, 1950), round ages otherwise. */
function linearTicks(newest: GeoTime, oldest: GeoTime): TimeTick[] {
  if (oldest <= HOLOCENE_BASE) {
    return niceTicks(calendarYearAt(oldest), calendarYearAt(newest), 5)
      .reverse()
      .map((year) => {
        const t = yearsBeforePresent(year)
        return { t, label: formatCalendar(t) }
      })
  }
  return niceTicks(newest, oldest, 5).map((t) => ({ t, label: formatAge(t) }))
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
  /** The unit the plotted samples declare; `''` when nothing was plotted. */
  unit: string
}

/** Headroom above and below the data so the trace never runs along the plot's edge. */
const VALUE_PAD_FRACTION = 0.06

/** One sample per unit step, `count + 1` in all, broken into runs wherever `sample` is null. */
export function sampleCurve(layer: Layer<ScalarValue>, axis: TimeAxis, count: number): ChartCurve {
  const runs: ChartPoint[][] = []
  let run: ChartPoint[] = []
  let lo = Infinity
  let hi = -Infinity
  let unit = ''
  for (let i = 0; i <= count; i++) {
    const u = i / count
    const t = axis.fromUnit(u)
    const v = layer.sample(t)
    if (v === null) {
      if (run.length > 1) runs.push(run)
      run = []
      continue
    }
    unit = v.unit
    const lower = v.bounds?.[0] ?? null
    const upper = v.bounds?.[1] ?? null
    run.push({ u, t, value: v.value, lower, upper })
    lo = Math.min(lo, v.value, lower ?? v.value)
    hi = Math.max(hi, v.value, upper ?? v.value)
  }
  if (run.length > 1) runs.push(run)
  return { runs, valueRange: Number.isFinite(lo) ? fitValueRange(lo, hi, unit) : null, unit }
}

/** Units whose zero is a convention rather than an absence: a temperature in °C, a sea level
 *  relative to today's. Plotting these against zero only flattens their change. */
const INTERVAL_SCALE_UNITS: ReadonlySet<string> = new Set(['°C', 'm'])

export function isIntervalScale(unit: string): boolean {
  return INTERVAL_SCALE_UNITS.has(unit)
}

/**
 * The data's extent plus headroom. A non-negative quantity with a real zero whose minimum is under
 * a quarter of its maximum (a count growing from near nothing) keeps zero as its floor, so its
 * growth reads as a proportion; anything else is fitted to its own range.
 */
export function fitValueRange(lo: number, hi: number, unit: string): [number, number] {
  if (!isIntervalScale(unit) && lo >= 0 && lo < hi / 4) return [0, hi * (1 + VALUE_PAD_FRACTION)]
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
