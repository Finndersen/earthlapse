/** Human-readable rendering of a `GeoTime`. Exported for other packages (layers, scene
 *  captions) that need to print a time without depending on the rest of the timeline UI. */

import type { GeoTime } from '@/types/layer'

import { calendarYearAt, HOLOCENE_BASE, PRESENT_CE_YEAR } from './epoch'
import type { TimeWindow } from './scale'

/** How a time is written: `'calendar'` years (`"1492"`, `"3200 BCE"`) inside the Holocene,
 *  where a reader thinks in dates, and elapsed `'age'` (`"11.7 ka"`, `"66 Ma"`) beyond it, where
 *  a calendar year would be false precision on a radiometric date. */
export type TimeNotation = 'calendar' | 'age'

export function notationAt(t: GeoTime): TimeNotation {
  return t <= HOLOCENE_BASE ? 'calendar' : 'age'
}

/** A window's notation is its oldest edge's, so an axis or range never mixes the two. */
export function notationForWindow([, oldest]: TimeWindow): TimeNotation {
  return notationAt(oldest)
}

/** Years before this are printed to the century: before writing, a date is an archaeological
 *  estimate and a single-year figure would read as more precise than it is. */
const PREHISTORIC_YEAR = -3000
const PREHISTORIC_RESOLUTION_YEARS = 100

const YEARS_PER_KA = 1e3
const YEARS_PER_MA = 1e6
const YEARS_PER_GA = 1e9

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** Below this `formatRate` prints a bound rather than a figure: two significant figures of a
 *  smaller rate are noise from the readout's smoothing. */
const MIN_PRINTED_RATE = 0.01

/** `value.toFixed(maxDecimals)` with trailing zeros (and a bare trailing `.`) stripped, e.g.
 *  `trimmed(10, 1) === '10'`, `trimmed(11.7, 1) === '11.7'`. */
function trimmed(value: number, maxDecimals: number): string {
  if (maxDecimals === 0) return Math.round(value).toString()
  const fixed = value.toFixed(maxDecimals)
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed
}

function assertGeoTime(t: GeoTime, caller: string): void {
  if (!Number.isFinite(t)) throw new Error(`${caller}: t must be finite, got ${t}`)
  if (t < 0) throw new Error(`${caller}: t must be >= 0 (years before present), got ${t}`)
}

/** `t` rounds to the present at year resolution — printed as `"present"` in either notation. */
function isPresent(t: GeoTime): boolean {
  return Math.round(t) === 0
}

/** The signed year at `t`, rounded to the resolution its era supports. */
function displayedYear(t: GeoTime): number {
  const year = Math.round(calendarYearAt(t))
  if (year >= PREHISTORIC_YEAR) return year
  return Math.round(year / PREHISTORIC_RESOLUTION_YEARS) * PREHISTORIC_RESOLUTION_YEARS
}

/** `1914 -> "1914"`, `476 -> "476 CE"`, `-3200 -> "3200 BCE"`. The era is left off a four-digit
 *  CE year, which cannot be mistaken for anything else. */
export function formatYear(year: number): string {
  if (year <= 0) return `${Math.max(1, -year)} BCE`
  return year < 1000 ? `${year} CE` : `${year}`
}

/**
 * Elapsed-time notation: `4.567e9 -> "4.57 Ga"`, `6.6e7 -> "66 Ma"`, `1.17e4 -> "11.7 ka"`,
 * `250 -> "250 years ago"`, `0 -> "present"`. The decimal count is fixed per magnitude bucket
 * (0 for years and Ma, 1 for ka, 2 for Ga), matching how these ages are conventionally written.
 */
export function formatAge(t: GeoTime): string {
  assertGeoTime(t, 'formatAge')
  if (t < YEARS_PER_KA) {
    const years = Math.round(t)
    if (years === 0) return 'present'
    return years === 1 ? '1 year ago' : `${years} years ago`
  }
  if (t < YEARS_PER_MA) return `${trimmed(t / YEARS_PER_KA, 1)} ka`
  if (t < YEARS_PER_GA) return `${trimmed(t / YEARS_PER_MA, 0)} Ma`
  return `${trimmed(t / YEARS_PER_GA, 2)} Ga`
}

/** Calendar notation at any `t`: `533 -> "1492"`, `5225 -> "3200 BCE"`, `0 -> "present"`. */
export function formatCalendar(t: GeoTime): string {
  assertGeoTime(t, 'formatCalendar')
  return isPresent(t) ? 'present' : formatYear(displayedYear(t))
}

/** `t` in the notation its era reads best in (`notationAt`). The default way to print a time. */
export function formatGeoTime(t: GeoTime): string {
  return notationAt(t) === 'calendar' ? formatCalendar(t) : formatAge(t)
}

/** The other reading of a calendar-era `t`, to print beside `formatGeoTime`'s: elapsed time for
 *  a date (`533 -> "533 years ago"`), and the anchor year for the present (`0 -> "2025"`). Null
 *  for an age, which has no calendar reading worth giving. */
export function formatCompanionReading(t: GeoTime): string | null {
  assertGeoTime(t, 'formatCompanionReading')
  if (notationAt(t) === 'age') return null
  if (isPresent(t)) return formatYear(PRESENT_CE_YEAR)
  const years = Math.round(t)
  return years === 1 ? '1 year ago' : `${years.toLocaleString('en-US')} years ago`
}

/** Extra decimal-digit budget `formatGeoTimePrecise` may reach for — enough for the K-Pg
 *  trio's ~0.01yr sub-gaps (ADR-017/ADR-021) to resolve to well under a minute, capped so a
 *  vanishingly small pixel budget can't produce an absurd digit count. */
const MAX_PRECISE_DECIMALS = 6

/** The number of years `formatGeoTime` already resolves to at `t`. `formatGeoTimePrecise` only
 *  reaches for extra precision once the local pixel budget needs to resolve something finer. */
function bucketResolutionYears(t: GeoTime): number {
  if (notationAt(t) === 'calendar') return calendarYearAt(t) < PREHISTORIC_YEAR ? PREHISTORIC_RESOLUTION_YEARS : 1
  if (t < YEARS_PER_KA) return 1
  if (t < YEARS_PER_MA) return YEARS_PER_KA / 10
  if (t < YEARS_PER_GA) return YEARS_PER_MA
  return YEARS_PER_GA / 100
}

/** A calendar reading finer than `formatCalendar`'s: the exact year, or the month once one pixel
 *  spans less than a year. Months are given only for CE years. */
function formatCalendarPrecise(t: GeoTime, precisionYears: number): string {
  const year = calendarYearAt(t)
  if (precisionYears >= 1 || year < 1) return formatYear(Math.round(year))
  const whole = Math.floor(year)
  const month = Math.min(11, Math.floor((year - whole) * 12))
  return `${MONTHS[month]} ${formatYear(whole)}`
}

/**
 * `formatGeoTime(t)`, but finer once the pointer's local resolution (`precisionYears` — years
 * spanned by one displayed pixel, see `yearsPerDisplayedPixelAt` in `fisheye.ts`) is finer than
 * what `formatGeoTime` already shows. Falls straight back to `formatGeoTime(t)` whenever it
 * already resolves at least as finely as one pixel does, or `precisionYears` isn't a usable
 * positive number. Inside a resolved gap an age switches to comma-grouped raw years with just
 * enough decimals that a 1px pointer move visibly changes the reading (the K-Pg trio reads
 * `"66,043,000 years ago"`, `"66,042,999.99 years ago"`, ...), and a calendar date to its exact
 * year or month.
 */
export function formatGeoTimePrecise(t: GeoTime, precisionYears: number): string {
  assertGeoTime(t, 'formatGeoTimePrecise')
  if (t === 0) return 'present'
  if (!(precisionYears > 0) || precisionYears >= bucketResolutionYears(t)) return formatGeoTime(t)
  if (notationAt(t) === 'calendar') return formatCalendarPrecise(t, precisionYears)

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

function formatAgeRange(newest: GeoTime, oldest: GeoTime): string {
  const newestBucket = sharedUnitBucket(newest)
  const oldestBucket = sharedUnitBucket(oldest)
  if (newestBucket !== null && newestBucket === oldestBucket) {
    const divisor = BUCKET_DIVISOR[newestBucket]
    const decimals = BUCKET_DECIMALS[newestBucket]
    const unit = BUCKET_UNIT[newestBucket]
    const newestPrinted = trimmed(newest / divisor, decimals)
    const oldestPrinted = trimmed(oldest / divisor, decimals)
    // Two distinct edges can still round alike ([66.000, 66.043] Ma); "66–66 Ma" reads as a glitch.
    if (newestPrinted === oldestPrinted) return `${newestPrinted} ${unit}`
    return `${oldestPrinted}–${newestPrinted} ${unit}`
  }
  return `${formatAge(oldest)} – ${formatAge(newest)}`
}

/** Both edges share an era suffix when they can: `"3200–500 BCE"`, `"500–1500 CE"`,
 *  `"1914–1945"`; otherwise each is written in full: `"27 BCE – 476 CE"`. */
function formatCalendarRange(newest: GeoTime, oldest: GeoTime): string {
  const newestYear = displayedYear(newest)
  const oldestYear = displayedYear(oldest)
  if (newestYear === oldestYear) return formatYear(newestYear)
  if (newestYear <= 0) return `${-oldestYear}–${Math.max(1, -newestYear)} BCE`
  if (oldestYear >= 1) return oldestYear >= 1000 ? `${oldestYear}–${newestYear}` : `${oldestYear}–${newestYear} CE`
  return `${formatYear(oldestYear)} – ${formatYear(newestYear)}`
}

/**
 * A compact label for a `TimeWindow`, in the window's own notation (`notationForWindow`) so
 * both edges read alike: `"252–201 Ma"`, `"11.7 ka – present"` beyond the Holocene;
 * `"3200–500 BCE"`, `"1914–1945"`, `"1914 – present"` inside it. Edges sharing a unit share one
 * suffix, older value first, geologic-notation style. The sub-millennium "years ago" band never
 * shares a unit with its neighbour — two bare year counts ("250–10") read as ambiguous.
 */
export function formatTimeRange(window: TimeWindow): string {
  const [newest, oldest] = window
  const notation = notationForWindow(window)
  const format = notation === 'calendar' ? formatCalendar : formatAge
  if (newest === oldest) return format(newest)
  if (isPresent(newest)) return `${format(oldest)} – present`
  return notation === 'calendar' ? formatCalendarRange(newest, oldest) : formatAgeRange(newest, oldest)
}

/**
 * A rate readout for the playback rate indicator: `4e7 -> "40 Myr/s"`, `2.1e5 -> "210 kyr/s"`,
 * `2.5 -> "2.5 yr/s"`, `0.13 -> "0.13 yr/s"`. Reuses `formatGeoTime`'s magnitude buckets but
 * labels them as durations (`yr`/`kyr`/`Myr`/`Gyr`) — a rate is a span of years crossed per
 * second, not an age. Below 10 yr/s it keeps two significant figures, so a smoothed reading of
 * the 1 yr/s steady detent prints "1 yr/s" and scenes mode's slow multipliers near the present
 * still read as a number.
 */
export function formatRate(yearsPerSecond: number): string {
  if (!Number.isFinite(yearsPerSecond) || yearsPerSecond < 0) {
    throw new Error(`formatRate: yearsPerSecond must be finite and >= 0, got ${yearsPerSecond}`)
  }
  if (yearsPerSecond === 0) return '0 yr/s'
  if (yearsPerSecond < MIN_PRINTED_RATE) return `< ${MIN_PRINTED_RATE} yr/s`
  if (yearsPerSecond < 10) return `${Number(yearsPerSecond.toPrecision(2))} yr/s`
  if (yearsPerSecond < YEARS_PER_KA) return `${trimmed(yearsPerSecond, 0)} yr/s`
  if (yearsPerSecond < YEARS_PER_MA) return `${trimmed(yearsPerSecond / YEARS_PER_KA, 1)} kyr/s`
  if (yearsPerSecond < YEARS_PER_GA) return `${trimmed(yearsPerSecond / YEARS_PER_MA, 0)} Myr/s`
  return `${trimmed(yearsPerSecond / YEARS_PER_GA, 2)} Gyr/s`
}
