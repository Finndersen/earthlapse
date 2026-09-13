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

/** Clamps to `[0, 1]`, treating `NaN` as `0` rather than letting it pass through unclamped. */
export function clampUnit(u: number): number {
  if (Number.isNaN(u)) return 0
  if (u < 0) return 0
  if (u > 1) return 1
  return u
}
