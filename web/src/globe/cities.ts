/**
 * The major-city markers' pure core (ADR-035): a city's population at `t`, how big its dot is,
 * and which cities survive the cull at a given globe size. No three.js, no React.
 *
 * `FeatureSet` deliberately ships no sampler of its own (`PopulationEstimateData`'s own doc
 * comment: "estimates for one feature are not assumed to interpolate between each other"). That
 * caution is about *inferring history* — a city can be sacked and rebuilt between two attested
 * readings, and no sampler should claim to know which. What this module does is narrower and is
 * a rendering decision, not a historical claim: a marker whose size jumped between attested
 * readings would strobe as the playhead crossed each one, so its size eases between them. The
 * tooltip always reports the reading the marker is actually between, never the interpolated
 * number, so nothing invented is ever shown as a figure.
 */

import type { FeatureData, GeoTime } from '@/types/layer'

// -------------------------------------------------------------------------------- sampling

/**
 * The city's population at `t`, or `null` before it has any attested reading at all — `t` older
 * than its oldest estimate. Eased log-linearly between bracketing readings (population is a
 * multiplicative quantity; a linear ramp across four orders of magnitude visibly lurches), and
 * held flat at the newest reading from there to the present, matching the "data ends, held after"
 * rule ADR-031 established for HYDE's own near-present edge.
 *
 * `estimates` is ascending in `t` (oldest last) and deduplicated by `parseFeatureData`, so the
 * scan below needs no re-sorting.
 */
export function cityPopulationAt(feature: FeatureData, t: GeoTime): number | null {
  const { estimates } = feature
  const oldest = estimates[estimates.length - 1]!
  const newest = estimates[0]!
  if (t > oldest.t) return null
  if (t <= newest.t) return newest.population
  for (let i = estimates.length - 1; i > 0; i--) {
    const older = estimates[i]!
    const younger = estimates[i - 1]!
    if (t <= older.t && t >= younger.t) {
      const span = older.t - younger.t
      const f = span > 0 ? (older.t - t) / span : 1
      return Math.exp(Math.log(older.population) + (Math.log(younger.population) - Math.log(older.population)) * f)
    }
  }
  return newest.population
}

/** The `[newest, oldest]` span the city has attested readings for — the tooltip's date range,
 *  in the same `TimeWindow` ordering `timeline/format.ts`'s `formatTimeRange` expects. */
export function cityEstimateRange(feature: FeatureData): readonly [GeoTime, GeoTime] {
  return [feature.estimates[0]!.t, feature.estimates[feature.estimates.length - 1]!.t]
}

// --------------------------------------------------------------------------------- sizing

/**
 * Marker radii, in CSS pixels, at the ends of the sized range. The published set spans 10,000
 * (the notability floor) to roughly 23 million people — four orders of magnitude — so radius is
 * mapped from `log10(population)`, not from its square root.
 *
 * That is a deliberate departure from the "area proportional to quantity" rule a statistical
 * bubble map would follow, and it is a legibility trade, not a claim: area-true sizing would
 * leave every city below about a million indistinguishable from the floor at globe scale, which
 * is most of the set for most of history. The dot says "a city, this big relative to its peers";
 * the tooltip carries the actual figure.
 */
const CITY_MIN_RADIUS_PX = 2.4
const CITY_MAX_RADIUS_PX = 9
const CITY_MIN_POPULATION = 1e4
const CITY_MAX_POPULATION = 2.4e7

export function cityRadiusPx(population: number): number {
  const low = Math.log10(CITY_MIN_POPULATION)
  const high = Math.log10(CITY_MAX_POPULATION)
  const f = Math.min(1, Math.max(0, (Math.log10(Math.max(population, 1)) - low) / (high - low)))
  return CITY_MIN_RADIUS_PX + (CITY_MAX_RADIUS_PX - CITY_MIN_RADIUS_PX) * f
}

// ---------------------------------------------------------------------------------- culling

/**
 * How many city markers may be drawn at once. The orb is a ~130px disc of which barely half
 * faces the viewer, so more than a handful of dots there is confetti, not information; expanded
 * (sphere or map) there is room for a real set. Both caps are far below the 164 published
 * cities, which is the point — the cap is what stops the late-modern frames turning solid.
 */
export const CITY_LIMIT_ORB = 10
export const CITY_LIMIT_EXPANDED = 45

export interface CityAtTime {
  feature: FeatureData
  /** Interpolated at `t` — see `cityPopulationAt`. */
  population: number
  radiusPx: number
}

/**
 * The `limit` largest cities that exist at `t`, largest first. Chosen by population *at `t`*, not
 * by any fixed ranking: at 3000 BCE that is Uruk and Memphis, at 1900 CE London and New York, and
 * the set turns over on its own as history does. Ties break on feature id so the selection is
 * deterministic and a scrub back to the same `t` reproduces it exactly.
 */
export function selectCities(features: readonly FeatureData[], t: GeoTime, limit: number): CityAtTime[] {
  const present: CityAtTime[] = []
  for (const feature of features) {
    const population = cityPopulationAt(feature, t)
    if (population === null) continue
    present.push({ feature, population, radiusPx: cityRadiusPx(population) })
  }
  present.sort((a, b) => b.population - a.population || a.feature.id.localeCompare(b.feature.id))
  return present.length > limit ? present.slice(0, limit) : present
}

/** Whether any city exists at `t` — the "Human civilisation" legend row's own visibility test
 *  for this part of the layer. Cheaper than `selectCities` and allocates nothing. */
export function citiesHaveDataAt(features: readonly FeatureData[] | null, t: GeoTime): boolean {
  if (features === null) return false
  for (const feature of features) {
    if (t <= feature.estimates[feature.estimates.length - 1]!.t) return true
  }
  return false
}
