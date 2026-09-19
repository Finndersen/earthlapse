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

import { unfoldedLiftedPosition } from './projection'

// -------------------------------------------------------------------------------- sampling

/**
 * How long past a city's last attested reading (`estimates[0]`, the newest) it keeps being drawn
 * before dropping out of the record entirely. Two shapes exist in the published data and must not
 * be conflated:
 *
 * - **The dataset's own trailing edge** (ADR-031: "data ends, held after") — Memphis, Egypt's
 *   newest reading is `t=50` (~1976), at the whole published set's own most recent sampling.
 *   Nothing says Memphis stopped existing; the compilers simply haven't sampled past that year, so
 *   holding it flat to the present is correct.
 * - **A city's own record ending**, centuries before that edge — Cahokia's newest reading is
 *   `t=625` (~1400 CE). Holding every city flat unconditionally would draw Cahokia as a
 *   40,000-person city *today*, alongside Uruk, Babylon, Tikal and Angkor at their own
 *   last-attested sizes, scattered across the modern map.
 *
 * The dataset cannot distinguish "genuinely abandoned" from "fell below the compilers' own
 * inclusion threshold" — both look identical here, a reading that stops. What can be told apart is
 * distance from the dataset's own most recent sampling: Memphis is 50 years back, Cahokia 625.
 * 200 years separates the two cleanly, with margin either side.
 *
 * This is a rendering heuristic, not a historical claim: nothing here (nor the tooltip, which only
 * ever reports an attested reading) says a city was destroyed or invents an end date it has no
 * record of. The marker fades out over this same window (`cityTrailingFadeAt`) rather than
 * popping, driven by `t`'s own distance from the newest reading — never a wall-clock timer — so
 * scrubbing reproduces it exactly either direction.
 */
export const CITY_TRAILING_GRACE_T = 200

/**
 * The city's population at `t`, or `null` when it has no attested reading there at all — either
 * `t` is older than its oldest estimate, or `t` is more than `CITY_TRAILING_GRACE_T` years past
 * its newest one (see that constant's own doc comment for why both bounds exist and what
 * distinguishes them). Eased log-linearly between bracketing readings (population is a
 * multiplicative quantity; a linear ramp across four orders of magnitude visibly lurches), and
 * held flat at the newest reading across the grace window past it.
 *
 * `estimates` is ascending in `t` (oldest last) and deduplicated by `parseFeatureData`, so the
 * scan below needs no re-sorting.
 */
export function cityPopulationAt(feature: FeatureData, t: GeoTime): number | null {
  const { estimates } = feature
  const oldest = estimates[estimates.length - 1]!
  const newest = estimates[0]!
  if (t > oldest.t) return null
  // Strictly `>`, not `>=`: matches `cityTrailingFadeAt`'s own `age >= CITY_TRAILING_GRACE_T -> 0`
  // exactly, so a city's existence (population non-null) and its marker's visibility (fade > 0)
  // end at precisely the same t rather than existence lingering one instant past full transparency.
  if (t <= newest.t) return t > newest.t - CITY_TRAILING_GRACE_T ? newest.population : null
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

/**
 * 1 while `t` is at or before the city's newest attested reading (fully within the record, or
 * still being interpolated between older readings); eases linearly to 0 as `t` moves up to
 * `CITY_TRAILING_GRACE_T` years past it — reaching exactly 0 where `cityPopulationAt` itself
 * starts returning `null`, so a marker fades out over the same window it disappears in rather
 * than popping. Callers scale the marker's own draw alpha by this.
 */
export function cityTrailingFadeAt(feature: FeatureData, t: GeoTime): number {
  const newest = feature.estimates[0]!
  if (t >= newest.t) return 1
  const age = newest.t - t
  if (age >= CITY_TRAILING_GRACE_T) return 0
  return 1 - age / CITY_TRAILING_GRACE_T
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
/** The biggest dots visibly merge into their neighbours in dense regions above this — part of
 *  "looks cluttered" is dot size, not just dot count (see `declutterCities`/`citySignificanceFloorAt`
 *  for the count side of that). */
const CITY_MAX_RADIUS_PX = 7
const CITY_MIN_POPULATION = 1e4
const CITY_MAX_POPULATION = 2.4e7

export function cityRadiusPx(population: number): number {
  const low = Math.log10(CITY_MIN_POPULATION)
  const high = Math.log10(CITY_MAX_POPULATION)
  const f = Math.min(1, Math.max(0, (Math.log10(Math.max(population, 1)) - low) / (high - low)))
  return CITY_MIN_RADIUS_PX + (CITY_MAX_RADIUS_PX - CITY_MIN_RADIUS_PX) * f
}

// ------------------------------------------------------------------------------ significance

/**
 * "Notable enough to draw" is era-relative: a town of 20,000 is a major city in 1500 and a suburb
 * today. A single fixed population floor can't express that — it either hides every ancient city
 * (Uruk peaked around 40,000) or admits every present-day village.
 *
 * Control points below (`t`, floor population), descending in `t`, log-interpolated between
 * neighbours (population is multiplicative, matching `cityPopulationAt`) and clamped flat beyond
 * both ends. Deliberately gentle: it only removes cities that were never notable at their own era.
 * Local crowding (a dense region reading as a solid mat of dots) is `declutterCities`'s job below —
 * a steeper floor can't tell "the only city for a thousand miles" from "a hamlet in a crowded
 * region" and would strip sparse regions along with dense ones.
 *
 * A function of `t` alone, never of the currently-largest city or any other city's population: a
 * threshold defined relative to other cities moves whenever they do, so a city holding steady at
 * 30,000 would drop out the moment some other city grew past whatever multiple defined the cutoff,
 * then return if that city later shrank — the same disappear/reappear failure `CITY_LIMIT_ORB`
 * documents for a rank cap. Pinning the floor to `t` alone makes that impossible: two calls at the
 * same `t` always agree regardless of which cities exist.
 *
 * At `t=300` (1725 CE) this floor sits above New York (~7,500), Buenos Aires (~3,100),
 * Philadelphia (~7,700) and Boston (~11,600) — genuinely that small then.
 */
const CITY_SIGNIFICANCE_FLOOR_POINTS: readonly (readonly [GeoTime, number])[] = [
  [10_000, 1_000],
  [5_000, 2_000],
  [2_000, 4_000],
  [1_000, 6_000],
  [500, 9_000],
  [300, 12_000],
  [125, 18_000],
  [50, 25_000],
  [0, 30_000],
]

/** Minimum population a city needs, at `t`, to count as notable enough to draw at all — see
 *  `CITY_SIGNIFICANCE_FLOOR_POINTS` for the curve. Monotonic non-increasing in `t` (non-decreasing
 *  moving forward through time), so a city's own population crossing it happens only as often as
 *  that population itself is non-monotonic — never because another city's population changed. */
export function citySignificanceFloorAt(t: GeoTime): number {
  const points = CITY_SIGNIFICANCE_FLOOR_POINTS
  const oldest = points[0]!
  const newest = points[points.length - 1]!
  if (t >= oldest[0]) return oldest[1]
  if (t <= newest[0]) return newest[1]
  for (let i = 1; i < points.length; i++) {
    const [olderT, olderFloor] = points[i - 1]!
    const [newerT, newerFloor] = points[i]!
    if (t <= olderT && t >= newerT) {
      const span = olderT - newerT
      const f = span > 0 ? (olderT - t) / span : 1
      return Math.exp(Math.log(olderFloor) + (Math.log(newerFloor) - Math.log(olderFloor)) * f)
    }
  }
  return newest[1]
}

// ---------------------------------------------------------------------------------- culling

/**
 * How many city markers the orb may draw at once. The orb is a ~130px disc of which barely half
 * faces the viewer, so more than a handful of dots there is confetti, not information — top-N by
 * population *at `t`* is exactly what makes it show Uruk in 3000 BCE and Tokyo today.
 *
 * Expanded (sphere or map) has no equivalent cap: a city that exists at `t` is drawn, full stop. A
 * fixed-count rank cap there would make a city's presence depend on how it ranks against every
 * *other* city at that instant rather than on whether it exists — cities dropping out and back in
 * as other cities' interpolated populations briefly overtake and fall back behind them, with a
 * ranking dominated by a handful of megacities starving sparser regions of any dots at all.
 * `MarkerField`'s instance budget (`HumanCivilisation.tsx`'s `MARKER_CAPACITY`) is sized for the
 * full published set instead.
 */
export const CITY_LIMIT_ORB = 10

export interface CityAtTime {
  feature: FeatureData
  /** Interpolated at `t` — see `cityPopulationAt`. */
  population: number
  radiusPx: number
  /** 1..0 draw-alpha multiplier for the trailing edge of the city's own record — see
   *  `cityTrailingFadeAt`'s own doc comment. Always 1 outside the grace window (either still
   *  within the attested/interpolated span, or — since `population` is `null` and the city is
   *  excluded entirely once past the grace window — never observed as a partial fade beyond it). */
  trailingFade: number
}

/** Every city that both exists at `t` (see `cityPopulationAt` — both the oldest-estimate bound
 *  and the newest-reading trailing grace) and clears `citySignificanceFloorAt(t)`, largest
 *  population first, ties broken on feature id so both the order and the set are deterministic
 *  and a scrub back to the same `t` reproduces both exactly. Shared core for `selectCities` (the
 *  orb's own ranked-and-capped view) and `allCitiesAt` (the expanded view's uncapped one) so the
 *  two can never define "exists" or "population order" differently from each other. */
function citiesAtTime(features: readonly FeatureData[], t: GeoTime): CityAtTime[] {
  const floor = citySignificanceFloorAt(t)
  const present: CityAtTime[] = []
  for (const feature of features) {
    const population = cityPopulationAt(feature, t)
    if (population === null || population < floor) continue
    present.push({ feature, population, radiusPx: cityRadiusPx(population), trailingFade: cityTrailingFadeAt(feature, t) })
  }
  present.sort((a, b) => b.population - a.population || a.feature.id.localeCompare(b.feature.id))
  return present
}

/**
 * The `limit` largest cities that exist at `t`, largest first — the orb's own ranked view (pass
 * `CITY_LIMIT_ORB`). Chosen by population *at `t`*, not by any fixed ranking: at 3000 BCE that is
 * Uruk and Memphis, at 1900 CE London and New York, and the set turns over on its own as history
 * does. Not for the expanded view — see `allCitiesAt`.
 */
export function selectCities(features: readonly FeatureData[], t: GeoTime, limit: number): CityAtTime[] {
  const present = citiesAtTime(features, t)
  return present.length > limit ? present.slice(0, limit) : present
}

/**
 * Every city that exists at `t` — no cap, no ranking cull. The expanded view's own city set: see
 * `CITY_LIMIT_ORB`'s doc comment for why the expanded view deliberately has no equivalent limit.
 */
export function allCitiesAt(features: readonly FeatureData[], t: GeoTime): CityAtTime[] {
  return citiesAtTime(features, t)
}

// ------------------------------------------------------------------------------- declutter

/**
 * The city's draw position, in the same object-space units `MarkerField` places the actual dot at
 * (`unfoldedLiftedPosition` at `radius = 1`, no lift — the real lift is a fraction of a percent of
 * the radius, immaterial to which cities crowd which).
 *
 * This is the *local* position, before `GlobeRotatingGroup`'s spin or the camera's orbit/pan are
 * applied, so two cities' mutual distance here is a rigid-transform invariant: rotating or panning
 * the view cannot change it. Only `unfold` (sphere <-> map) and zoom (the caller's `minSeparation`,
 * converted from screen pixels using the live camera distance) can change which cities a caller
 * keeps — camera rotation/pan cannot, so a marginal city on the silhouette's edge cannot flicker
 * in and out as the globe spins or is dragged.
 */
export function cityLocalPosition(feature: FeatureData, unfold: number): readonly [number, number, number] {
  return unfoldedLiftedPosition({ lon: feature.lon, lat: feature.lat }, unfold, 1, 0, 0)
}

/**
 * Screen-space declutter: walks `cities` (expected already sorted largest-first, `citiesAtTime`'s
 * own order) and keeps each one unless it falls within `minSeparation` of an already-kept, larger
 * city. `positionOf` supplies each city's position in whatever space `minSeparation` is measured
 * in (the caller converts a screen-pixel budget into that space once, using the live camera
 * distance — see `cityLocalPosition` for why the positions themselves need no camera at all).
 *
 * Local and blind to rank, unlike a fixed top-N (`CITY_LIMIT_ORB`): a city is only ever removed
 * for having a closer, bigger neighbour that was kept first, so a sparse region where no two
 * cities are ever close together keeps every one of them, while a packed region thins hard. A
 * global rank cap can't do this — it strips a sparse region bare while a crowded one still shows
 * its own top N regardless of how unreadable they are packed together.
 *
 * Deterministic given a fixed `minSeparation`: the walk order is fixed, so the same `(cities,
 * positionOf, minSeparation)` always keeps the same set — a scrub back to the same `t` at the same
 * zoom reproduces it exactly.
 */
export function declutterCities<T>(cities: readonly T[], positionOf: (city: T) => readonly [number, number, number], minSeparation: number): T[] {
  if (minSeparation <= 0 || cities.length === 0) return cities.slice()
  const kept: T[] = []
  const keptPositions: (readonly [number, number, number])[] = []
  const thresholdSq = minSeparation * minSeparation
  for (const city of cities) {
    const pos = positionOf(city)
    let tooClose = false
    for (const keptPos of keptPositions) {
      const dx = pos[0] - keptPos[0]
      const dy = pos[1] - keptPos[1]
      const dz = pos[2] - keptPos[2]
      if (dx * dx + dy * dy + dz * dz < thresholdSq) {
        tooClose = true
        break
      }
    }
    if (!tooClose) {
      kept.push(city)
      keptPositions.push(pos)
    }
  }
  return kept
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

// ---------------------------------------------------------------------------------- labels

/**
 * How long, in years of `t` (`GeoTime` is always years before present — `@/types/layer`'s own
 * doc comment), a city's name label stays on screen after it first appears: full opacity exactly
 * at the city's oldest estimate, easing linearly to 0 as `t` moves this far *past* it (i.e.
 * forward in time, toward the present — see `cityLabelOpacityAt`). A window in `t`, not
 * wall-clock time: nothing here reads a clock, so scrubbing back to a city's founding always
 * reproduces the same label at the same strength, matching the project's standing "nothing fades
 * on inactivity, only `t` does" rule.
 *
 * Sized against the published set's own sampling grid: consecutive first-appearance times are as
 * little as 25 years apart near the present and several hundred apart in antiquity (HYDE's own
 * resolution), and as many as 34 cities share the *exact* same first-appearance `t`. 150 years is
 * wide enough for the fade to read as a fade rather than a flash, without bleeding so far past a
 * cohort that it starts to overlap the next distinct one.
 */
export const CITY_LABEL_FADE_WINDOW_T = 150

/** How many name labels may render at once, most recently appeared first (`newCityLabels`'s own
 *  ordering).
 *
 *  Labelling every new marker is the behaviour to want and the data will not support it: HYDE's
 *  sampling grid puts up to 42 cities at the *exact* same first-appearance `t`, and up to 76
 *  inside the fade window at once, so an uncapped set is a wall of overlapping text. The cap is
 *  deterministic rather than "however many fit", so scrubbing back to the same `t` always
 *  reproduces the same labels.
 *
 *  Twelve covers every cohort that fits on screen without stacking: it is enough for the whole
 *  t=225 cohort, whose smallest member (Sydney, 2,000 people in 1800) would otherwise be dropped
 *  purely for being small at the moment it appeared. */
export const CITY_LABEL_CAP = 12

export interface CityLabel {
  feature: FeatureData
  /** 1 right as the city first appears, easing to 0 over `CITY_LABEL_FADE_WINDOW_T` — see that
   *  constant's own doc comment. */
  opacity: number
}

/** The city's own label opacity at `t`: 0 before it exists, easing from 1 down to 0 across
 *  `CITY_LABEL_FADE_WINDOW_T` years after its first appearance, 0 again beyond that window. */
export function cityLabelOpacityAt(feature: FeatureData, t: GeoTime): number {
  const oldest = feature.estimates[feature.estimates.length - 1]!.t
  const age = oldest - t
  if (age < 0 || age >= CITY_LABEL_FADE_WINDOW_T) return 0
  return 1 - age / CITY_LABEL_FADE_WINDOW_T
}

/**
 * Labels for the cities in `cities` that just appeared at `t`, capped at `CITY_LABEL_CAP`.
 *
 * Ranked by `opacity` — that is, by how recently the city appeared — and only then by population.
 * Recency has to lead: the label announces an arrival, and a city is at its smallest the moment
 * it arrives. Ranking by population instead let large cities from the same cohort take every
 * slot, so a newly founded one was labelled only once it had grown enough to win one, decoupling
 * the label from the event it exists to mark. Melbourne appeared 30th of 31 candidates and was
 * labelled 25 years late; Sydney 29th of 29, and a century late.
 *
 * Population still breaks ties within one appearance time (up to 34 cities share an exact
 * first-appearance `t` on HYDE's grid), and the id breaks the remainder, so the result stays a
 * pure function of `t`.
 */
export function newCityLabels(cities: readonly CityAtTime[], t: GeoTime): CityLabel[] {
  const candidates: { label: CityLabel; population: number }[] = []
  for (const city of cities) {
    const opacity = cityLabelOpacityAt(city.feature, t)
    if (opacity > 0) candidates.push({ label: { feature: city.feature, opacity }, population: city.population })
  }
  candidates.sort(
    (a, b) =>
      b.label.opacity - a.label.opacity ||
      b.population - a.population ||
      a.label.feature.id.localeCompare(b.label.feature.id),
  )
  return candidates.slice(0, CITY_LABEL_CAP).map((c) => c.label)
}
