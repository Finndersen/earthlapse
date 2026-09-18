/**
 * Value-formatting helpers for the readout/chart components in this package. Deliberately
 * separate from `@/timeline`'s `formatGeoTime`, which formats a `GeoTime` (years BP) rather
 * than a layer's `value`.
 */

/**
 * A compact human rendering of a layer value: whole numbers once the magnitude is large
 * enough that a decimal is noise (≥100), one decimal in the 1–100 range, two significant
 * figures below 1. Never rounds to a bare `"0"` for a genuinely nonzero value.
 */
export function formatValue(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const abs = Math.abs(value)
  if (abs === 0) return '0'
  if (abs >= 100) return Math.round(value).toString()
  if (abs >= 1) return trimTrailingZero(value.toFixed(1))
  return value.toPrecision(2)
}

function trimTrailingZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** Ascending so the smallest matching scale wins first; `formatPopulation` walks it from the
 *  top down and steps back in when rounding tips a value over into the next tier (e.g. 999.95
 *  million rounding to "1000 million" reports as "1.0 billion" instead). */
const POPULATION_SCALES: ReadonlyArray<{ scale: number; word: string }> = [
  { scale: 1e3, word: 'thousand' },
  { scale: 1e6, word: 'million' },
  { scale: 1e9, word: 'billion' },
  { scale: 1e12, word: 'trillion' },
]

function formatAtTier(abs: number, tierIndex: number): string {
  const tier = POPULATION_SCALES[tierIndex]
  if (tier === undefined) return Math.round(abs).toLocaleString('en-US')
  const scaled = abs / tier.scale
  const decimals = scaled < 10 ? 1 : 0
  const rounded = Number(scaled.toFixed(decimals))
  // A value that rounds up to a bare 1000 at this tier belongs one tier higher instead (e.g.
  // "1000 million" -> "1.0 billion") -- otherwise the last, coarsest-rounded values in a tier
  // would misreport their own scale word.
  if (rounded >= 1000 && tierIndex + 1 < POPULATION_SCALES.length) {
    return formatAtTier(abs, tierIndex + 1)
  }
  return `${rounded.toFixed(decimals)} ${tier.word}`
}

/**
 * A human-scale count, unambiguous across orders of magnitude: `2_400_000 -> "2.4 million"`,
 * `1_000_000_000 -> "1.0 billion"`, `232_000_000 -> "232 million"`. One decimal place while the
 * scaled value is under 10 (so "1.0 billion" reads as an approximation, not a suspiciously round
 * exact figure), a whole number once it reaches double digits (so "232 million" reads the way a
 * person would actually say it, not "232.0 million"). Below 1,000, a plain comma-grouped integer
 * — this project's population data never reaches that low, but the function stays total. Unlike
 * `formatValue`, this is for one unit only (a `ScalarValue` whose `unit` is `'people'`, dispatched
 * by `formatScalarValue` below) — a plain `formatValue` render of a global population (e.g.
 * "7256964920") would not be "unambiguous across four orders of magnitude", the readout's own
 * requirement.
 */
export function formatPopulation(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs < 1000) return sign + Math.round(abs).toLocaleString('en-US')
  let tierIndex = POPULATION_SCALES.length - 1
  while (tierIndex > 0 && abs < POPULATION_SCALES[tierIndex]!.scale) tierIndex--
  return sign + formatAtTier(abs, tierIndex)
}

/** Dispatches a scalar layer's numeric formatting by its declared `unit` — `formatPopulation`
 *  for a population count, `formatValue` (unchanged) for every other unit (ppm, °C, m, ...).
 *  Keeps `ScalarReadout`/`LayerChart` generic: neither special-cases a layer by id, only by the
 *  physical unit its data already declares. */
export function formatScalarValue(value: number, unit: string): string {
  return unit === 'people' ? formatPopulation(value) : formatValue(value)
}

/** Clamps to `[0, 1]`, treating `NaN` as `0` rather than letting it pass through unclamped. */
export function clampUnit(u: number): number {
  if (Number.isNaN(u)) return 0
  if (u < 0) return 0
  if (u > 1) return 1
  return u
}
