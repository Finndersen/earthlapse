/**
 * Shared y-axis policy for scalar-layer charts (`Sparkline`'s trend line and `LayerChart`'s
 * full plot) — pure, so it's tested independently of either component's rendering.
 *
 * Log vs linear is decided from the data itself, not per layer id: a series whose max/min
 * reaches `LOG_AXIS_MIN_RATIO` is plotted on a log axis, otherwise linear. This is what already
 * kept CO2's ~277 -> 427 ppm industrial rise visible against its ~7,000 ppm Cambrian peak (a
 * ~42x ratio) in `Sparkline`. Global population needs the same treatment far more acutely: HYDE's
 * curated series runs from ~4.4 million (10,000 BCE) to ~7.3 billion (2015 CE), a ~1,600x ratio,
 * with 99% of the rise crammed into the last 0.2% of the domain. On a linear axis that's a flat
 * line with a vertical spike at the right edge; log spreads the whole history's growth across the
 * plot instead. A layer whose values include zero or negative numbers (e.g. a temperature
 * anomaly) can't take a log axis at all, so this always falls back to linear rather than
 * throwing — callers that plot such a layer just get the same linear axis they'd get today.
 */

export const LOG_AXIS_MIN_RATIO = 10

export interface AxisTransform {
  /** Pure, monotonic value -> axis-space mapping. `Math.log` when `isLog`, identity otherwise. */
  toAxis: (value: number) => number
  isLog: boolean
}

export function axisTransform(values: readonly number[]): AxisTransform {
  if (values.length === 0) return { toAxis: (value) => value, isLog: false }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const isLog = min > 0 && max / min >= LOG_AXIS_MIN_RATIO
  return { toAxis: isLog ? Math.log : (value) => value, isLog }
}
