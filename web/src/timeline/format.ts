/** Human-readable rendering of a `GeoTime`. Exported for other packages (layers, scene
 *  captions) that need to print a time without depending on the rest of the timeline UI. */

import type { GeoTime } from '@/types/layer'

const YEARS_PER_KA = 1e3
const YEARS_PER_MA = 1e6
const YEARS_PER_GA = 1e9

/** `value.toFixed(maxDecimals)` with trailing zeros (and a bare trailing `.`) stripped, e.g.
 *  `trimmed(10, 1) === '10'`, `trimmed(11.7, 1) === '11.7'`. */
function trimmed(value: number, maxDecimals: number): string {
  if (maxDecimals === 0) return Math.round(value).toString()
  const fixed = value.toFixed(maxDecimals)
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
}

/**
 * `4.567e9 -> "4.57 Ga"`, `6.6e7 -> "66 Ma"`, `1.17e4 -> "11.7 ka"`, `250 -> "250 years ago"`,
 * `0 -> "present"`. The decimal count is fixed per magnitude bucket (0 for years and Ma, 1
 * for ka, 2 for Ga) rather than a uniform significant-figure rule, matching how these ages
 * are conventionally written (event dates in Ma are whole numbers; deep-time eras in Ga carry
 * two decimals; the ka band is where precision starts mattering to a human reading the axis).
 */
export function formatGeoTime(t: GeoTime): string {
  if (!Number.isFinite(t)) {
    throw new Error(`formatGeoTime: t must be finite, got ${t}`)
  }
  if (t < 0) {
    throw new Error(`formatGeoTime: t must be >= 0 (years before present), got ${t}`)
  }

  if (t < YEARS_PER_KA) {
    const years = Math.round(t)
    if (years === 0) return 'present'
    return years === 1 ? '1 year ago' : `${years} years ago`
  }
  if (t < YEARS_PER_MA) return `${trimmed(t / YEARS_PER_KA, 1)} ka`
  if (t < YEARS_PER_GA) return `${trimmed(t / YEARS_PER_MA, 0)} Ma`
  return `${trimmed(t / YEARS_PER_GA, 2)} Ga`
}
