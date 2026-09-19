import { describe, expect, it } from 'vitest'

import type { FeatureData } from '@/types/layer'

import {
  allCitiesAt,
  CITY_LABEL_CAP,
  CITY_LABEL_FADE_WINDOW_T,
  CITY_TRAILING_GRACE_T,
  cityEstimateRange,
  cityLabelOpacityAt,
  cityLocalPosition,
  cityPopulationAt,
  cityRadiusPx,
  citiesHaveDataAt,
  citySignificanceFloorAt,
  cityTrailingFadeAt,
  declutterCities,
  newCityLabels,
  selectCities,
  type CityAtTime,
} from './cities'

// Estimates ascending by t, as parseFeatureData leaves them (newest first, oldest last).
const URUK: FeatureData = {
  id: 'uruk-iraq',
  name: 'Uruk',
  country: 'Iraq',
  lat: 31.32,
  lon: 45.64,
  certainty: 'high',
  estimates: [
    { t: 4000, population: 40_000 },
    { t: 6700, population: 14_000 },
  ],
}

describe('cityPopulationAt', () => {
  it('is null older than the oldest estimate', () => {
    expect(cityPopulationAt(URUK, 6701)).toBeNull()
  })

  it('is the exact value at an exact estimate', () => {
    expect(cityPopulationAt(URUK, 6700)).toBe(14_000)
    expect(cityPopulationAt(URUK, 4000)).toBe(40_000)
  })

  it('is log-interpolated between two estimates', () => {
    // f = 0.5 at the midpoint in t, so the interpolated value is exactly the geometric mean.
    const mid = cityPopulationAt(URUK, 5350)!
    expect(mid).toBeCloseTo(Math.sqrt(14_000 * 40_000), 0)
    expect(mid).toBeGreaterThan(14_000)
    expect(mid).toBeLessThan(40_000)
  })

  it('is held flat across the trailing grace window past the newest estimate', () => {
    expect(cityPopulationAt(URUK, 3999)).toBe(40_000)
    expect(cityPopulationAt(URUK, 4000 - CITY_TRAILING_GRACE_T + 1)).toBe(40_000)
  })

  it('drops out of the record once the trailing grace window has fully elapsed (cities that ceased to exist must stop being drawn, not hold flat forever)', () => {
    expect(cityPopulationAt(URUK, 4000 - CITY_TRAILING_GRACE_T)).toBeNull()
    expect(cityPopulationAt(URUK, 0)).toBeNull()
  })
})

describe('cityPopulationAt — trailing grace window (real published shapes)', () => {
  // Cahokia's own record stops in 1400 CE — its own newest reading, not the dataset's edge.
  // Memphis's newest reading (t=50) sits right at the whole published set's own most recent
  // sampling (t=25 is the earliest any city is attested) — ADR-031's "data ends, held after" rule
  // is right for it.
  const CAHOKIA: FeatureData = {
    id: 'cahokia-usa',
    name: 'Cahokia',
    country: 'United States of America',
    lat: 38.66,
    lon: -90.06,
    certainty: 'high',
    estimates: [
      { t: 625, population: 40_000 }, // newest — ~1400 CE
      { t: 925, population: 4_000 }, // oldest — ~1100 CE
    ],
  }
  const MEMPHIS: FeatureData = {
    id: 'memphis-egypt',
    name: 'Memphis',
    country: 'Egypt',
    lat: 29.85,
    lon: 31.25,
    certainty: 'high',
    estimates: [
      { t: 50, population: 846_000 }, // newest — the dataset's own trailing edge, ~1976
      { t: 4525, population: 30_000 }, // oldest
    ],
  }
  const PRESENT_T = 25 // the dataset's own most recent sampling year across every city

  it('does not draw a city whose record ended centuries before the dataset’s own edge, at the present', () => {
    expect(cityPopulationAt(CAHOKIA, PRESENT_T)).toBeNull()
  })

  it('draws that same city at its own newest attested reading', () => {
    expect(cityPopulationAt(CAHOKIA, 625)).toBe(40_000)
  })

  it('still draws a city whose newest reading sits at the dataset’s own trailing edge, at the present', () => {
    expect(cityPopulationAt(MEMPHIS, PRESENT_T)).toBe(846_000)
  })
})

describe('cityTrailingFadeAt', () => {
  const CAHOKIA_NEWEST_T = 625
  const CITY: FeatureData = {
    id: 'cahokia-usa',
    name: 'Cahokia',
    country: 'United States of America',
    lat: 38.66,
    lon: -90.06,
    certainty: 'high',
    estimates: [
      { t: CAHOKIA_NEWEST_T, population: 40_000 },
      { t: 925, population: 4_000 },
    ],
  }

  it('is 1 at and before the newest reading', () => {
    expect(cityTrailingFadeAt(CITY, CAHOKIA_NEWEST_T)).toBe(1)
    expect(cityTrailingFadeAt(CITY, 700)).toBe(1)
  })

  it('eases linearly to 0 across the grace window past the newest reading', () => {
    const half = CAHOKIA_NEWEST_T - CITY_TRAILING_GRACE_T / 2
    expect(cityTrailingFadeAt(CITY, half)).toBeCloseTo(0.5, 5)
  })

  it('is exactly 0 once the grace window has fully elapsed, and beyond — the same t cityPopulationAt starts returning null at', () => {
    expect(cityTrailingFadeAt(CITY, CAHOKIA_NEWEST_T - CITY_TRAILING_GRACE_T)).toBe(0)
    expect(cityTrailingFadeAt(CITY, 0)).toBe(0)
  })
})

describe('cityEstimateRange', () => {
  it('returns [newest, oldest], the TimeWindow order formatTimeRange expects', () => {
    expect(cityEstimateRange(URUK)).toEqual([4000, 6700])
  })
})

describe('cityRadiusPx', () => {
  it('is monotonically non-decreasing across the sized range and clamps flat past both ends', () => {
    const populations = [1, 100, 1e4, 1e5, 1e6, 1e7, 2.4e7, 1e9]
    let previous = -Infinity
    for (const p of populations) {
      const r = cityRadiusPx(p)
      expect(r).toBeGreaterThanOrEqual(previous)
      previous = r
    }
  })

  it('clamps to the same floor radius for any population at or below the minimum', () => {
    expect(cityRadiusPx(1)).toBe(cityRadiusPx(1e4))
  })

  it('clamps to the same ceiling radius for any population at or above the maximum', () => {
    expect(cityRadiusPx(2.4e7)).toBe(cityRadiusPx(1e9))
  })

  it('gives a larger city a strictly larger radius within the sized range', () => {
    expect(cityRadiusPx(1e6)).toBeGreaterThan(cityRadiusPx(1e5))
  })
})

describe('selectCities', () => {
  // Ranking flips between the two sample times: A is bigger in deep antiquity, B overtakes it
  // by the more recent estimate.
  // Populations clear `citySignificanceFloorAt` at both sampled `t`s (100 and 3000) — this suite
  // is about ranking, not the significance floor (see the dedicated `citySignificanceFloorAt`
  // suite below), so fixtures stay well above it in either direction.
  const CITY_A: FeatureData = {
    id: 'a-city',
    name: 'A',
    country: 'X',
    lat: 0,
    lon: 0,
    certainty: 'high',
    estimates: [
      { t: 100, population: 50_000 },
      { t: 3000, population: 200_000 },
    ],
  }
  const CITY_B: FeatureData = {
    id: 'b-city',
    name: 'B',
    country: 'X',
    lat: 0,
    lon: 0,
    certainty: 'high',
    estimates: [
      { t: 100, population: 900_000 },
      { t: 3000, population: 5000 },
    ],
  }

  it('ranks by population at t, not by any fixed ranking — the ordering flips between two times', () => {
    expect(selectCities([CITY_A, CITY_B], 3000, 5).map((c) => c.feature.id)).toEqual(['a-city', 'b-city'])
    expect(selectCities([CITY_A, CITY_B], 100, 5).map((c) => c.feature.id)).toEqual(['b-city', 'a-city'])
  })

  it('caps the result at limit, largest first', () => {
    const selected = selectCities([CITY_A, CITY_B], 100, 1)
    expect(selected).toHaveLength(1)
    expect(selected[0]!.feature.id).toBe('b-city')
  })

  it('excludes a city with no attested reading yet at t', () => {
    expect(selectCities([CITY_A, CITY_B], 5000, 5)).toEqual([])
  })

  it('carries the population, a matching radiusPx and a full (1) trailing fade for each selected city', () => {
    const [top] = selectCities([CITY_A, CITY_B], 100, 5)
    expect(top).toEqual({ feature: CITY_B, population: 900_000, radiusPx: cityRadiusPx(900_000), trailingFade: 1 })
  })

  it('breaks a population tie deterministically by feature id', () => {
    const tiedA: FeatureData = { ...CITY_A, id: 'z-city', estimates: [{ t: 100, population: 50_000 }] }
    const tiedB: FeatureData = { ...CITY_B, id: 'y-city', estimates: [{ t: 100, population: 50_000 }] }
    expect(selectCities([tiedA, tiedB], 100, 5).map((c) => c.feature.id)).toEqual(['y-city', 'z-city'])
  })
})

describe('allCitiesAt', () => {
  // A small, long-lived city that exists throughout; a cohort of much larger cities that are
  // only founded partway through — before they exist, `small` is the only city around; after,
  // dozens of cities outrank it by population, exactly the shape of the real published set (a
  // handful of megacities dominate the ranking almost everywhere, HYDE's own growth curve).
  // Newest reading at t=0 for every feature here (not a single reading in antiquity) so the
  // trailing-grace fix (`CITY_TRAILING_GRACE_T`, `cityTrailingFadeAt`) never enters into it — this
  // test is isolated to the population-rank cull, a separate bug from the trailing-grace one.
  const small: FeatureData = {
    id: 'small-city',
    name: 'Small',
    country: 'X',
    lat: 0,
    lon: 0,
    certainty: 'high',
    estimates: [
      { t: 0, population: 50_000 },
      { t: 2000, population: 50_000 },
    ],
  }
  const bigCohort: FeatureData[] = Array.from({ length: 50 }, (_, i) => ({
    id: `big-city-${i}`,
    name: `Big ${i}`,
    country: 'X',
    lat: 0,
    lon: 0,
    certainty: 'high',
    estimates: [
      { t: 0, population: 999_000 },
      { t: 1000, population: 999_000 },
    ],
  }))
  const features = [small, ...bigCohort]

  it('never culls by population rank — a city present at t1 stays present at a later t2 even after 50 larger cities have grown past it', () => {
    const t1 = 1500 // before the big cohort exists: `small` is the only city around
    const t2 = 500 // after the whole cohort exists and outranks `small`

    expect(allCitiesAt(features, t1).map((c) => c.feature.id)).toEqual(['small-city'])

    const atT2 = allCitiesAt(features, t2)
    expect(atT2.map((c) => c.feature.id)).toContain('small-city')
    // `small` is ranked well past 45 here — a fixed-limit `selectCities(features, t2, 45)` would
    // drop it, which `allCitiesAt` must not. Both assertions make that contrast explicit.
    const rankAtT2 = atT2.findIndex((c) => c.feature.id === 'small-city')
    expect(rankAtT2).toBeGreaterThan(45)
    expect(selectCities(features, t2, 45).map((c) => c.feature.id)).not.toContain('small-city')
  })

  it('returns every city that exists at t, largest population first, ties broken by id', () => {
    const bigger: FeatureData = { ...small, id: 'z-city', estimates: [{ t: 100, population: 900_000 }] }
    // Above `citySignificanceFloorAt(100)` (this suite is about ordering, not the floor).
    const smaller: FeatureData = { ...small, id: 'a-city', estimates: [{ t: 100, population: 30_000 }] }
    expect(allCitiesAt([smaller, bigger], 100).map((c) => c.feature.id)).toEqual(['z-city', 'a-city'])
  })

  it('excludes a city with no attested reading yet at t', () => {
    expect(allCitiesAt([small], 2001)).toEqual([])
  })
})

describe('citiesHaveDataAt', () => {
  const CITY: FeatureData = URUK

  it('is false for null features', () => {
    expect(citiesHaveDataAt(null, 0)).toBe(false)
  })

  it('is true once at least one feature has an attested reading at t', () => {
    expect(citiesHaveDataAt([CITY], 6700)).toBe(true)
  })

  it('is false when every feature is older than t', () => {
    expect(citiesHaveDataAt([CITY], 6701)).toBe(false)
  })
})

describe('cityLabelOpacityAt', () => {
  // Founded (oldest estimate) at t = 1000.
  const founded: FeatureData = {
    id: 'founded-city',
    name: 'Founded',
    country: 'X',
    lat: 0,
    lon: 0,
    certainty: 'high',
    estimates: [{ t: 1000, population: 10_000 }],
  }

  it('is 0 before the city exists', () => {
    expect(cityLabelOpacityAt(founded, 1001)).toBe(0)
  })

  it('is full strength exactly at the city’s first-appearance t', () => {
    expect(cityLabelOpacityAt(founded, 1000)).toBe(1)
  })

  it('eases linearly to 0 as t moves forward past first appearance', () => {
    const half = 1000 - CITY_LABEL_FADE_WINDOW_T / 2
    expect(cityLabelOpacityAt(founded, half)).toBeCloseTo(0.5, 5)
  })

  it('is 0 once the fade window has fully elapsed, and beyond', () => {
    expect(cityLabelOpacityAt(founded, 1000 - CITY_LABEL_FADE_WINDOW_T)).toBe(0)
    expect(cityLabelOpacityAt(founded, 0)).toBe(0)
  })

  it('is a pure function of t — scrubbing back reproduces the exact same opacity', () => {
    const t = 1000 - CITY_LABEL_FADE_WINDOW_T / 4
    expect(cityLabelOpacityAt(founded, t)).toBe(cityLabelOpacityAt(founded, t))
  })
})

describe('newCityLabels', () => {
  function cityAt(id: string, foundedT: number, population: number): CityAtTime {
    const feature: FeatureData = { id, name: id, country: 'X', lat: 0, lon: 0, certainty: 'high', estimates: [{ t: foundedT, population }] }
    // trailingFade is irrelevant to label selection (a separate axis — see cityTrailingFadeAt);
    // every case below queries at/near the city's own founding t, well within its grace window.
    return { feature, population, radiusPx: cityRadiusPx(population), trailingFade: 1 }
  }

  it('includes only cities within the fade window of their own first appearance', () => {
    const justFounded = cityAt('new-city', 1000, 10_000)
    const longEstablished = cityAt('old-city', 5000, 10_000)
    const notYetFounded = cityAt('future-city', 400, 10_000)
    const cities = [justFounded, longEstablished, notYetFounded]

    expect(newCityLabels(cities, 1000).map((l) => l.feature.id)).toEqual(['new-city'])
  })

  it('caps the number of simultaneous labels, largest population first, deterministically', () => {
    // 34 cities founded at the exact same t — the published set really does have cohorts this
    // large (HYDE's own sampling grid), so an uncapped result would be a wall of text.
    const cohort: CityAtTime[] = Array.from({ length: 34 }, (_, i) => cityAt(`cohort-${i}`, 1000, 1000 + i))
    // Sorted largest-first, as `allCitiesAt`/`selectCities` already leave it.
    cohort.sort((a, b) => b.population - a.population)

    const labels = newCityLabels(cohort, 1000)
    expect(labels).toHaveLength(CITY_LABEL_CAP)
    expect(labels.map((l) => l.feature.id)).toEqual(cohort.slice(0, CITY_LABEL_CAP).map((c) => c.feature.id))
    // Every label in a same-t cohort is at full opacity.
    expect(labels.every((l) => l.opacity === 1)).toBe(true)
  })

  it('reproduces the exact same selection on a repeated call at the same t (deterministic scrub-back)', () => {
    const cohort: CityAtTime[] = Array.from({ length: 10 }, (_, i) => cityAt(`c-${i}`, 1000, 1000 + i)).sort(
      (a, b) => b.population - a.population,
    )
    expect(newCityLabels(cohort, 950)).toEqual(newCityLabels(cohort, 950))
  })
})

describe('citySignificanceFloorAt', () => {
  it('is monotonic non-increasing in t — never higher further into the past', () => {
    const ts = [0, 25, 50, 100, 125, 200, 300, 500, 1000, 2000, 3000, 5000, 8000, 10_000, 15_000]
    let previous = Infinity
    for (const t of ts) {
      const floor = citySignificanceFloorAt(t)
      expect(floor).toBeLessThanOrEqual(previous)
      previous = floor
    }
  })

  it('clamps flat beyond both ends of the curve', () => {
    expect(citySignificanceFloorAt(50_000)).toBe(citySignificanceFloorAt(10_000))
  })

  it('is higher near the present than in deep antiquity', () => {
    expect(citySignificanceFloorAt(0)).toBeGreaterThan(citySignificanceFloorAt(10_000))
  })

  it('depends only on t, never on any other city — a floor relative to other cities would reintroduce rank-based flicker', () => {
    // A city holding a small but constant population, checked alongside a cohort of much larger
    // cities added later — mirrors `allCitiesAt`'s own "never culls by population rank" fixture.
    // A floor defined *relative to* the current largest city would drop this one out the moment
    // the cohort appeared and outranked it (the very bug this whole feature exists to avoid
    // reintroducing); a floor that is a pure function of `t` alone cannot do that.
    const t = 800
    const floor = citySignificanceFloorAt(t)
    const steady: FeatureData = {
      id: 'steady-city',
      name: 'Steady',
      country: 'X',
      lat: 10,
      lon: 10,
      certainty: 'high',
      estimates: [
        { t: 0, population: floor * 1.2 },
        { t: 2000, population: floor * 1.2 },
      ],
    }
    const cohort: FeatureData[] = Array.from({ length: 30 }, (_, i) => ({
      id: `cohort-${i}`,
      name: `Cohort ${i}`,
      country: 'X',
      lat: 0,
      lon: 0,
      certainty: 'high',
      estimates: [
        { t: 0, population: 5_000_000 },
        { t: 2000, population: 5_000_000 },
      ],
    }))
    expect(allCitiesAt([steady], t).map((c) => c.feature.id)).toContain('steady-city')
    expect(allCitiesAt([steady, ...cohort], t).map((c) => c.feature.id)).toContain('steady-city')
  })
})

describe('allCitiesAt — significance floor', () => {
  it('excludes a city whose population at t is below the era-relative significance floor', () => {
    const t = 300
    const floor = citySignificanceFloorAt(t)
    const tooSmall: FeatureData = {
      id: 'tiny-village',
      name: 'Tiny',
      country: 'X',
      lat: 0,
      lon: 0,
      certainty: 'high',
      estimates: [{ t, population: Math.max(1, floor - 1) }],
    }
    expect(allCitiesAt([tooSmall], t)).toEqual([])
  })

  it('includes a city right at the floor, excludes one just under it', () => {
    const t = 300
    const floor = citySignificanceFloorAt(t)
    const atFloor: FeatureData = {
      id: 'at-floor',
      name: 'AtFloor',
      country: 'X',
      lat: 0,
      lon: 0,
      certainty: 'high',
      estimates: [{ t, population: floor }],
    }
    const underFloor: FeatureData = { ...atFloor, id: 'under-floor', estimates: [{ t, population: floor - 1 }] }
    expect(allCitiesAt([atFloor], t).map((c) => c.feature.id)).toEqual(['at-floor'])
    expect(allCitiesAt([underFloor], t)).toEqual([])
  })

  it('sweeping t from deep antiquity to the present, a city that stays comfortably above the floor never flips visible -> hidden -> visible (no-oscillation regression)', () => {
    const city: FeatureData = {
      id: 'steady-notable',
      name: 'Steady Notable',
      country: 'X',
      lat: 0,
      lon: 0,
      certainty: 'high',
      estimates: [
        { t: 0, population: 200_000 },
        { t: 5000, population: 50_000 },
      ],
    }
    const sweep = [5000, 3000, 2000, 1000, 500, 300, 125, 50, 25, 0]
    const visibility = sweep.map((t) => allCitiesAt([city], t).length > 0)
    expect(visibility.every(Boolean)).toBe(true)
  })
})

describe('declutterCities', () => {
  function cityAt(id: string, population: number): CityAtTime {
    const feature: FeatureData = { id, name: id, country: 'X', lat: 0, lon: 0, certainty: 'high', estimates: [{ t: 0, population }] }
    return { feature, population, radiusPx: cityRadiusPx(population), trailingFade: 1 }
  }

  it('keeps every city when they are all far apart (sparse region)', () => {
    const positions: Record<string, readonly [number, number, number]> = { a: [0, 0, 0], b: [100, 0, 0], c: [-100, 0, 0] }
    const cities = [cityAt('a', 100), cityAt('b', 90), cityAt('c', 80)]
    const kept = declutterCities(cities, (c) => positions[c.feature.id]!, 10)
    expect(kept.map((c) => c.feature.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('drops a smaller city that falls within the separation of a larger, already-kept one (dense region thins)', () => {
    const positions: Record<string, readonly [number, number, number]> = { big: [0, 0, 0], small: [1, 0, 0], far: [100, 0, 0] }
    const cities = [cityAt('big', 100), cityAt('small', 90), cityAt('far', 80)]
    const kept = declutterCities(cities, (c) => positions[c.feature.id]!, 10)
    expect(kept.map((c) => c.feature.id)).toEqual(['big', 'far'])
  })

  it('is deterministic — the same input always yields the same kept set', () => {
    const positions: Record<string, readonly [number, number, number]> = { a: [0, 0, 0], b: [2, 0, 0], c: [4, 0, 0], d: [200, 0, 0] }
    const cities = [cityAt('a', 100), cityAt('b', 95), cityAt('c', 90), cityAt('d', 85)]
    const project = (c: CityAtTime): readonly [number, number, number] => positions[c.feature.id]!
    expect(declutterCities(cities, project, 10).map((c) => c.feature.id)).toEqual(
      declutterCities(cities, project, 10).map((c) => c.feature.id),
    )
  })

  it("a distant third city never changes whether a closer pair's smaller member is kept — locality, not global rank", () => {
    const positions: Record<string, readonly [number, number, number]> = { a: [0, 0, 0], b: [1, 0, 0], c: [500, 0, 0] }
    const project = (c: CityAtTime): readonly [number, number, number] => positions[c.feature.id]!
    const withoutC = declutterCities([cityAt('a', 100), cityAt('b', 90)], project, 10)
    const withC = declutterCities([cityAt('a', 100), cityAt('b', 90), cityAt('c', 50)], project, 10)
    expect(withoutC.map((c) => c.feature.id)).toEqual(['a'])
    expect(withC.map((c) => c.feature.id)).toEqual(['a', 'c'])
  })

  it('returns every city unchanged when minSeparation is 0', () => {
    const cities = [cityAt('a', 100), cityAt('b', 90)]
    expect(declutterCities(cities, () => [0, 0, 0], 0)).toEqual(cities)
  })
})

describe('cityLocalPosition', () => {
  const A: FeatureData = { id: 'a', name: 'A', country: 'X', lat: 12, lon: 34, certainty: 'high', estimates: [{ t: 0, population: 1 }] }
  const B: FeatureData = { id: 'b', name: 'B', country: 'X', lat: 12, lon: 35, certainty: 'high', estimates: [{ t: 0, population: 1 }] }

  it('is a pure function of lon/lat/unfold — the same inputs always give the same position (no camera or rotation dependence in the signature at all)', () => {
    expect(cityLocalPosition(A, 0)).toEqual(cityLocalPosition(A, 0))
    expect(cityLocalPosition(A, 1)).toEqual(cityLocalPosition(A, 1))
  })

  it('gives distinct positions for distinct lon/lat, in both sphere and map mode', () => {
    expect(cityLocalPosition(A, 0)).not.toEqual(cityLocalPosition(B, 0))
    expect(cityLocalPosition(A, 1)).not.toEqual(cityLocalPosition(B, 1))
  })
})
