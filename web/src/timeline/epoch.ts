/**
 * The fixed calendar anchor for `GeoTime`: `t = PRESENT_CE_YEAR - year`, where `year` is
 * signed historian's numbering (3200 BCE is -3200; there is no year zero, and `t` does not
 * skip one). This is the conversion every curated source and data/events.yaml uses, so the
 * anchor moves only with a re-normalisation of the whole data set, never with the wall clock.
 */

import type { GeoTime } from '@/types/layer'

export const PRESENT_CE_YEAR = 2025

/** The ICS chart gives the Holocene base as 11,700 years before AD 2000 (b2k); shifted onto
 *  `PRESENT_CE_YEAR`. */
export const HOLOCENE_BASE: GeoTime = 11_700 + (PRESENT_CE_YEAR - 2000)

/** `t` of a signed calendar year (`-3200` for 3200 BCE). */
export function yearsBeforePresent(year: number): GeoTime {
  return PRESENT_CE_YEAR - year
}

/** The signed calendar year at `t`, fractional. Inverse of `yearsBeforePresent`. */
export function calendarYearAt(t: GeoTime): number {
  return PRESENT_CE_YEAR - t
}
