import { describe, expect, it } from 'vitest'

import type { FeatureData } from '@/types/layer'

import { cityEstimateRange, cityPopulationAt, cityRadiusPx, citiesHaveDataAt, selectCities } from './cities'

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

  it('is held flat at the newest estimate from there through the present', () => {
    expect(cityPopulationAt(URUK, 3999)).toBe(40_000)
    expect(cityPopulationAt(URUK, 0)).toBe(40_000)
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
  const CITY_A: FeatureData = {
    id: 'a-city',
    name: 'A',
    country: 'X',
    lat: 0,
    lon: 0,
    certainty: 'high',
    estimates: [
      { t: 100, population: 5000 },
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
      { t: 3000, population: 1000 },
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

  it('carries the population and a matching radiusPx for each selected city', () => {
    const [top] = selectCities([CITY_A, CITY_B], 100, 5)
    expect(top).toEqual({ feature: CITY_B, population: 900_000, radiusPx: cityRadiusPx(900_000) })
  })

  it('breaks a population tie deterministically by feature id', () => {
    const tiedA: FeatureData = { ...CITY_A, id: 'z-city', estimates: [{ t: 100, population: 5000 }] }
    const tiedB: FeatureData = { ...CITY_B, id: 'y-city', estimates: [{ t: 100, population: 5000 }] }
    expect(selectCities([tiedA, tiedB], 100, 5).map((c) => c.feature.id)).toEqual(['y-city', 'z-city'])
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
