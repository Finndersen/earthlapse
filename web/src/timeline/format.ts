/** Human-readable rendering of a `GeoTime`. Exported for other packages (layers, scene
 *  captions) that need to print a time without depending on the rest of the timeline UI. */

import type { GeoTime } from '@/types/layer'

import type { TimeWindow } from './scale'

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

/** Extra decimal-digit budget `formatGeoTimePrecise` may reach for — enough for the K-Pg
 *  trio's ~0.01yr sub-gaps (ADR-017/ADR-021) to resolve to well under a minute, capped so a
 *  vanishingly small pixel budget can't produce an absurd digit count. */
const MAX_PRECISE_DECIMALS = 6

/** The number of years `formatGeoTime`'s own magnitude bucket already resolves to at `t` — its
 *  fixed per-bucket decimal count (0 for years/Ma, 1 for ka, 2 for Ga), expressed as years.
 *  `formatGeoTimePrecise` only reaches for extra precision once the local pixel budget needs to
 *  resolve something finer than this. */
function bucketResolutionYears(t: GeoTime): number {
  if (t < YEARS_PER_KA) return 1
  if (t < YEARS_PER_MA) return YEARS_PER_KA / 10
  if (t < YEARS_PER_GA) return YEARS_PER_MA
  return YEARS_PER_GA / 100
}

/**
 * `formatGeoTime(t)`, but with extra decimal digits of raw years once the pointer's local
 * resolution (`precisionYears` — years spanned by one displayed pixel, see
 * `yearsPerDisplayedPixelAt` in `fisheye.ts`) is finer than what `formatGeoTime`'s own magnitude
 * bucket already shows. Falls straight back to `formatGeoTime(t)` whenever the ambient bucket
 * already resolves at least as finely as one pixel does (the common case at rest, away from the
 * density-adaptive fisheye lens) or `precisionYears` isn't a usable positive number (an
 * unmeasured track, say) — so a caller can use this everywhere `formatGeoTime` was used for a
 * pointer-driven readout with no visible change outside a resolved gap. Inside one, it switches
 * to comma-grouped raw years with just enough decimals that a 1px pointer move visibly changes
 * the reading — e.g. the K-Pg trio reads as `"66,043,000 years ago"`, `"66,042,999.99 years
 * ago"`, `"66,042,900 years ago"` once the lens has spread them past a pixel apart, rather than
 * all three collapsing to `formatGeoTime`'s own `"66 Ma"`.
 */
export function formatGeoTimePrecise(t: GeoTime, precisionYears: number): string {
  if (!Number.isFinite(t)) {
    throw new Error(`formatGeoTimePrecise: t must be finite, got ${t}`)
  }
  if (t < 0) {
    throw new Error(`formatGeoTimePrecise: t must be >= 0 (years before present), got ${t}`)
  }
  if (t === 0) return 'present'
  if (!(precisionYears > 0) || precisionYears >= bucketResolutionYears(t)) return formatGeoTime(t)

  const decimals = Math.min(MAX_PRECISE_DECIMALS, Math.max(0, Math.ceil(-Math.log10(precisionYears))))
  const grouped = t.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return `${grouped} years ago`
}

type SharedUnitBucket = 'ka' | 'ma' | 'ga'

function sharedUnitBucket(t: GeoTime): SharedUnitBucket | null {
  if (t < YEARS_PER_KA) return null // see formatTimeRange's doc comment for why
  if (t < YEARS_PER_MA) return 'ka'
  if (t < YEARS_PER_GA) return 'ma'
  return 'ga'
}

const BUCKET_UNIT: Record<SharedUnitBucket, string> = { ka: 'ka', ma: 'Ma', ga: 'Ga' }
const BUCKET_DIVISOR: Record<SharedUnitBucket, number> = { ka: YEARS_PER_KA, ma: YEARS_PER_MA, ga: YEARS_PER_GA }
const BUCKET_DECIMALS: Record<SharedUnitBucket, number> = { ka: 1, ma: 0, ga: 2 }

/**
 * A compact label for a `TimeWindow`: `"12 ka – present"`, `"252–201 Ma"`. When both edges fall
 * in the same magnitude bucket (ka/Ma/Ga) they share one
 * unit suffix, geologic-notation style with the older value first (`"252–201 Ma"`, not
 * `"201–252 Ma"`); otherwise each edge renders in full via `formatGeoTime`. A window touching
 * the present renders its far edge plus `"present"` rather than `"present"`'s own bucket-less
 * `formatGeoTime` form. The sub-millennium "years ago" band never shares a unit with its
 * neighbour — pairing two bare year counts ("250–10") reads as ambiguous where the other
 * buckets don't ("252–201 Ma" is unambiguous because "Ma" is right there).
 */
export function formatTimeRange([newest, oldest]: TimeWindow): string {
  if (newest === oldest) return formatGeoTime(newest)
  if (newest === 0) return `${formatGeoTime(oldest)} – present`

  const newestBucket = sharedUnitBucket(newest)
  const oldestBucket = sharedUnitBucket(oldest)
  if (newestBucket !== null && newestBucket === oldestBucket) {
    const divisor = BUCKET_DIVISOR[newestBucket]
    const decimals = BUCKET_DECIMALS[newestBucket]
    const unit = BUCKET_UNIT[newestBucket]
    return `${trimmed(oldest / divisor, decimals)}–${trimmed(newest / divisor, decimals)} ${unit}`
  }

  return `${formatGeoTime(oldest)} – ${formatGeoTime(newest)}`
}

/**
 * A rate readout for the playback speed indicator (ADR-016 — the prototype instantaneous
 * years-per-second display beside the mode toggle): `4e7 -> "40 Myr/s"`, `2.1e5 -> "210 kyr/s"`,
 * `0.4 -> "< 1 yr/s"`. Reuses `formatGeoTime`'s magnitude buckets (its divisors are the same
 * "years per ka/Ma/Ga" figures) but labels them as durations (`yr`/`kyr`/`Myr`/`Gyr`) rather
 * than points in time (`years ago`/`ka`/`Ma`/`Ga`) — a rate is a span of years crossed per
 * second, not an age. The caller is responsible for the "≈" this is always an approximation
 * (an instantaneous, smoothed rate, not an exact figure).
 */
export function formatRate(yearsPerSecond: number): string {
  if (!Number.isFinite(yearsPerSecond) || yearsPerSecond < 0) {
    throw new Error(`formatRate: yearsPerSecond must be finite and >= 0, got ${yearsPerSecond}`)
  }
  if (yearsPerSecond < 1) return '< 1 yr/s'
  if (yearsPerSecond < YEARS_PER_KA) return `${trimmed(yearsPerSecond, 0)} yr/s`
  if (yearsPerSecond < YEARS_PER_MA) return `${trimmed(yearsPerSecond / YEARS_PER_KA, 1)} kyr/s`
  if (yearsPerSecond < YEARS_PER_GA) return `${trimmed(yearsPerSecond / YEARS_PER_MA, 0)} Myr/s`
  return `${trimmed(yearsPerSecond / YEARS_PER_GA, 2)} Gyr/s`
}
