/**
 * Shared y-axis policy for scalar-layer charts (`Sparkline`, `LayerChart`) — pure, tested
 * independently of either component's rendering.
 *
 * Log vs linear is decided from the data itself, not per layer id: a series whose max/min
 * reaches `LOG_AXIS_MIN_RATIO` plots on a log axis, otherwise linear. Needed for CO2 (~42x,
 * 277->427 ppm industrial rise vs. ~7,000 ppm Cambrian peak) and far more acutely for population
 * (HYDE's curated series is ~1,600x, 4.4M at 10,000 BCE to 7.3B in 2015 CE, 99% of the rise in
 * the last 0.2% of the domain — linear renders that as a flat line with a spike at the right
 * edge). Values including zero or negative (e.g. a temperature anomaly) can't take a log axis,
 * so this falls back to linear rather than throwing.
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
