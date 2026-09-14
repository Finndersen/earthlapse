/**
 * Tier-2 procedural score parameters (ADR-023 §2, DESIGN §11). Restricted to what
 * `WorldState`/`Manifest` actually publish today: `co2`, `day_length`, and `events-core`'s
 * `catastrophe` tag (temperature/biodiversity mappings are additive follow-ups once
 * `paleoclimate`/`pbdb` land — ADR-023 Consequences). Pure in its three arguments; no import
 * of `tone` — the Tone.js LFO/detune texture ADR-023 §2 calls "never loops, never ends" is a
 * mixing decision `engine.ts` layers on top of these parameters, not part of this module.
 */

import { EARTH_FORMATION, type GeoTime } from '@/types/layer'

import { bump, clampUnit, type TimeWindow } from './ramp'

export interface ScoreParams {
  /** Drone fundamental, Hz — one octave lower in deep time than at present. */
  rootHz: number
  /** Low-pass cutoff, Hz — `co2Ppm`-driven brightness. */
  filterCutoffHz: number
  /** Rhythmic pulse rate, Hz — `dayLengthHours`-driven. */
  pulseHz: number
  /** 0 (open/major) .. 1 (minor/dissonant cluster) — proximity to a catastrophe. */
  dissonance: number
}

const ROOT_HZ_PRESENT = 55
/** One octave (halved) at the oldest `t`; `rootHz` glides linearly in `log1p(t)` between. */
const ROOT_HZ_OCTAVE_DROP = 0.5

/** Present-day published CO2 (`~420` ppm, ADR-023 §2) — the neutral default when a manifest
 *  has no sample at this `t` (`TimeSeries.sample`'s own None-outside-domain contract,
 *  `pipeline/shapes.py`). */
const CO2_PRESENT_DEFAULT_PPM = 420
/** Roughly the full span deep-time CO2 estimates cover (ppm) — an ice-age low to a Precambrian
 *  high — mapped log-scale onto the filter's musical range, since CO2 itself varies by orders
 *  of magnitude across Earth's history, not linearly. */
const CO2_MIN_PPM = 150
const CO2_MAX_PPM = 8000
const FILTER_CUTOFF_MIN_HZ = 400
const FILTER_CUTOFF_MAX_HZ = 4000

/** Present-day day length — the neutral default when a manifest has no sample at this `t`. */
const DAY_LENGTH_PRESENT_DEFAULT_HOURS = 24
/** Earth's day length has lengthened from roughly this to the present 24h (tidal drag). */
const DAY_LENGTH_MIN_HOURS = 6
const DAY_LENGTH_MAX_HOURS = 24
const PULSE_HZ_MIN = 0.1
const PULSE_HZ_MAX = 2

function clampRange(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

/** Higher CO2 -> lower cutoff (a thicker, warmer atmosphere reads as a softer high end);
 *  log-scaled across `[CO2_MIN_PPM, CO2_MAX_PPM]`, clamped to a musical range. */
function filterCutoffFromCo2(co2Ppm: number): number {
  const clamped = clampRange(co2Ppm, CO2_MIN_PPM, CO2_MAX_PPM)
  const u = (Math.log(clamped) - Math.log(CO2_MIN_PPM)) / (Math.log(CO2_MAX_PPM) - Math.log(CO2_MIN_PPM))
  return FILTER_CUTOFF_MAX_HZ - u * (FILTER_CUTOFF_MAX_HZ - FILTER_CUTOFF_MIN_HZ)
}

/** Shorter day -> faster pulse; linear across `[DAY_LENGTH_MIN_HOURS, DAY_LENGTH_MAX_HOURS]`,
 *  clamped to a slow, non-audio-rate arpeggiation range. */
function pulseHzFromDayLength(dayLengthHours: number): number {
  const clamped = clampRange(dayLengthHours, DAY_LENGTH_MIN_HOURS, DAY_LENGTH_MAX_HOURS)
  const u = (clamped - DAY_LENGTH_MIN_HOURS) / (DAY_LENGTH_MAX_HOURS - DAY_LENGTH_MIN_HOURS)
  return PULSE_HZ_MAX - u * (PULSE_HZ_MAX - PULSE_HZ_MIN)
}

/**
 * The score's four parameters at `t`. `series.co2Ppm`/`series.dayLengthHours` are `null` when
 * the manifest has no sample at this `t`; each falls back to its present-day neutral default
 * rather than throwing or reading `undefined`. `catastropheWindows`: every `Manifest.events`
 * entry whose `tags` includes `'catastrophe'`, as `[tMin, tMax]` — derived once by the caller
 * (`engine.ts`), the same way `stemGains`'s `flatBasaltWindows` is; a `catastrophe`-tagged
 * event and a `flood-basalt`-effect event overlap but are not the same filter (ADR-023 §2), so
 * the two derivations stay separate even though both feed the shared `bump` shape.
 */
export function scoreParams(
  t: GeoTime,
  series: { co2Ppm: number | null; dayLengthHours: number | null },
  catastropheWindows: ReadonlyArray<TimeWindow>,
): ScoreParams {
  const rootHz = ROOT_HZ_PRESENT * (1 - ROOT_HZ_OCTAVE_DROP * (Math.log1p(t) / Math.log1p(EARTH_FORMATION)))
  const co2Ppm = series.co2Ppm ?? CO2_PRESENT_DEFAULT_PPM
  const dayLengthHours = series.dayLengthHours ?? DAY_LENGTH_PRESENT_DEFAULT_HOURS
  const dissonance = clampUnit(catastropheWindows.reduce((sum, window) => sum + bump(t, window), 0))

  return {
    rootHz,
    filterCutoffHz: filterCutoffFromCo2(co2Ppm),
    pulseHz: pulseHzFromDayLength(dayLengthHours),
    dissonance,
  }
}
