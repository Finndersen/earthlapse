import { describe, expect, it } from 'vitest'

import { playbackSecondsBetween, scenePlaybackSegments, yearsForPlaybackSeconds } from '@/scene/pacing'
import type { FeatureData, GeoTime } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import {
  allCitiesAt,
  CITY_LABEL_CAP,
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

function city(id: string, estimates: FeatureData['estimates'], lat = 0, lon = 0): FeatureData {
  return { id, name: id, country: 'X', lat, lon, certainty: 'high', estimates }
}

function cityAt(id: string, population: number, foundedT = 0): CityAtTime {
  return { feature: city(id, [{ t: foundedT, population }]), population, radiusPx: cityRadiusPx(population), trailingFade: 1 }
}

// Estimates ascending by t, as the parser leaves them.
const URUK = city('uruk', [
  { t: 4000, population: 40_000 },
  { t: 6700, population: 14_000 },
])

describe('cityPopulationAt', () => {
  it('is exact at an estimate and log-interpolated between', () => {
    expect(cityPopulationAt(URUK, 6700)).toBe(14_000)
    expect(cityPopulationAt(URUK, 4000)).toBe(40_000)
    expect(cityPopulationAt(URUK, 5350)).toBeCloseTo(Math.sqrt(14_000 * 40_000), 0)
  })

  it('is null before the oldest estimate and after the trailing grace window', () => {
    expect(cityPopulationAt(URUK, 6701)).toBeNull()
    expect(cityPopulationAt(URUK, 4000 - CITY_TRAILING_GRACE_T + 1)).toBe(40_000)
    expect(cityPopulationAt(URUK, 4000 - CITY_TRAILING_GRACE_T)).toBeNull()
    expect(cityPopulationAt(URUK, 0)).toBeNull()
  })

  it("holds a city whose newest reading is at the dataset's edge through the present", () => {
    const memphis = city('memphis', [
      { t: 50, population: 846_000 },
      { t: 4525, population: 30_000 },
    ])
    expect(cityPopulationAt(memphis, 25)).toBe(846_000)
  })
})

describe('cityTrailingFadeAt', () => {
  it('is 1 through the newest reading, then eases linearly to 0 over the grace window', () => {
    expect(cityTrailingFadeAt(URUK, 4500)).toBe(1)
    expect(cityTrailingFadeAt(URUK, 4000)).toBe(1)
    expect(cityTrailingFadeAt(URUK, 4000 - CITY_TRAILING_GRACE_T / 2)).toBeCloseTo(0.5, 5)
    expect(cityTrailingFadeAt(URUK, 4000 - CITY_TRAILING_GRACE_T)).toBe(0)
  })
})

describe('cityEstimateRange / cityRadiusPx / citiesHaveDataAt', () => {
  it('returns the estimate range as [newest, oldest]', () => {
    expect(cityEstimateRange(URUK)).toEqual([4000, 6700])
  })

  it('sizes radius monotonically, clamped at both ends', () => {
    let previous = -Infinity
    for (const p of [1, 1e4, 1e5, 1e6, 2.4e7, 1e9]) {
      expect(cityRadiusPx(p)).toBeGreaterThanOrEqual(previous)
      previous = cityRadiusPx(p)
    }
    expect(cityRadiusPx(1)).toBe(cityRadiusPx(1e4))
    expect(cityRadiusPx(2.4e7)).toBe(cityRadiusPx(1e9))
    expect(cityRadiusPx(1e6)).toBeGreaterThan(cityRadiusPx(1e5))
  })

  it('reports data only once some city is attested', () => {
    expect(citiesHaveDataAt(null, 0)).toBe(false)
    expect(citiesHaveDataAt([URUK], 6700)).toBe(true)
    expect(citiesHaveDataAt([URUK], 6701)).toBe(false)
  })
})

describe('selectCities', () => {
  const A = city('a-city', [
    { t: 100, population: 50_000 },
    { t: 3000, population: 200_000 },
  ])
  const B = city('b-city', [
    { t: 100, population: 900_000 },
    { t: 3000, population: 5000 },
  ])

  it('ranks by population at t, capped at limit', () => {
    expect(selectCities([A, B], 3000, 5).map((c) => c.feature.id)).toEqual(['a-city', 'b-city'])
    expect(selectCities([A, B], 100, 1)).toEqual([{ feature: B, population: 900_000, radiusPx: cityRadiusPx(900_000), trailingFade: 1 }])
    expect(selectCities([A, B], 5000, 5)).toEqual([])
  })

  it('breaks a population tie by id', () => {
    const z = city('z', [{ t: 100, population: 50_000 }])
    const y = city('y', [{ t: 100, population: 50_000 }])
    expect(selectCities([z, y], 100, 5).map((c) => c.feature.id)).toEqual(['y', 'z'])
  })
})

describe('allCitiesAt', () => {
  const small = city('small', [
    { t: 0, population: 50_000 },
    { t: 2000, population: 50_000 },
  ])
  const cohort = Array.from({ length: 50 }, (_, i) =>
    city(`big-${i}`, [
      { t: 0, population: 999_000 },
      { t: 1000, population: 999_000 },
    ]),
  )

  it('never culls by population rank', () => {
    expect(allCitiesAt([small, ...cohort], 1500).map((c) => c.feature.id)).toEqual(['small'])
    const later = allCitiesAt([small, ...cohort], 500)
    expect(later.findIndex((c) => c.feature.id === 'small')).toBeGreaterThan(45)
  })

  it('orders largest first and excludes unattested cities', () => {
    const bigger = city('z', [{ t: 100, population: 900_000 }])
    const smaller = city('a', [{ t: 100, population: 30_000 }])
    expect(allCitiesAt([smaller, bigger], 100).map((c) => c.feature.id)).toEqual(['z', 'a'])
    expect(allCitiesAt([small], 2001)).toEqual([])
  })

  it('applies the significance floor inclusively', () => {
    const floor = citySignificanceFloorAt(300)
    expect(allCitiesAt([city('at', [{ t: 300, population: floor }])], 300)).toHaveLength(1)
    expect(allCitiesAt([city('under', [{ t: 300, population: floor - 1 }])], 300)).toEqual([])
  })

  it('keeps a city comfortably above the floor visible across a full sweep', () => {
    const notable = city('notable', [
      { t: 0, population: 200_000 },
      { t: 5000, population: 50_000 },
    ])
    for (const t of [5000, 2000, 500, 125, 25, 0]) expect(allCitiesAt([notable], t)).toHaveLength(1)
  })
})

describe('citySignificanceFloorAt', () => {
  it('never rises into the past and clamps beyond the curve', () => {
    let previous = Infinity
    for (const t of [0, 50, 125, 300, 1000, 3000, 10_000]) {
      expect(citySignificanceFloorAt(t)).toBeLessThanOrEqual(previous)
      previous = citySignificanceFloorAt(t)
    }
    expect(citySignificanceFloorAt(0)).toBeGreaterThan(citySignificanceFloorAt(10_000))
    expect(citySignificanceFloorAt(50_000)).toBe(citySignificanceFloorAt(10_000))
  })
})

describe('cityLabelOpacityAt', () => {
  const founded = city('founded', [{ t: 1000, population: 10_000 }])

  it('is full at first appearance and eases to 0 over the fade window', () => {
    expect(cityLabelOpacityAt(founded, 1001, 150)).toBe(0)
    expect(cityLabelOpacityAt(founded, 1000, 150)).toBe(1)
    expect(cityLabelOpacityAt(founded, 925, 150)).toBeCloseTo(0.5, 5)
    expect(cityLabelOpacityAt(founded, 850, 150)).toBe(0)
    expect(cityLabelOpacityAt(founded, 1000, 0)).toBe(0)
  })
})

describe('newCityLabels', () => {
  const fixed = (): GeoTime => 150

  it('labels only cities within their own fade window', () => {
    const cities = [cityAt('new', 10_000, 1000), cityAt('old', 10_000, 5000), cityAt('future', 10_000, 400)]
    expect(newCityLabels(cities, 1000, fixed).map((l) => l.feature.id)).toEqual(['new'])
  })

  it('caps simultaneous labels, largest first', () => {
    const cohort = Array.from({ length: 34 }, (_, i) => cityAt(`c-${i}`, 1000 + i, 1000)).sort((a, b) => b.population - a.population)
    const labels = newCityLabels(cohort, 1000, fixed)
    expect(labels.map((l) => l.feature.id)).toEqual(cohort.slice(0, CITY_LABEL_CAP).map((c) => c.feature.id))
    expect(labels.every((l) => l.opacity === 1)).toBe(true)
  })

  it("sizes each window from the city's first-appearance t", () => {
    const seen: GeoTime[] = []
    newCityLabels([cityAt('c', 10_000, 1000)], 950, (appearanceT) => {
      seen.push(appearanceT)
      return 150
    })
    expect(seen).toEqual([1000])
  })

  it('gives labels equal playback-seconds in differently paced stretches', () => {
    const scene = (id: string, t: GeoTime): Scene => ({
      id,
      t,
      chapterId: 'ch',
      image: `${id}.png`,
      thumbnail: `${id}-thumb.png`,
      shot: 'WIDE_RIDGE',
      title: id,
      caption: id,
      width: 1920,
      height: 1080,
    })
    const dense = scenePlaybackSegments([0, 60, 140, 225, 300].map((t, i) => scene(`d${i}`, t)))
    const sparse = scenePlaybackSegments([0, 3e9, 3.5e9, 4e9, 4.5e9].map((t, i) => scene(`s${i}`, t)))
    const denseWindow = yearsForPlaybackSeconds(dense, 140, 3.5)
    const sparseWindow = yearsForPlaybackSeconds(sparse, 3.5e9, 3.5)
    expect(sparseWindow).toBeGreaterThan(denseWindow * 1000)
    expect(
      newCityLabels([cityAt('dense', 10_000, 140)], 140 - denseWindow / 2, (t) => yearsForPlaybackSeconds(dense, t, 3.5)),
    ).toHaveLength(1)
    expect(playbackSecondsBetween(dense, 140 - denseWindow, 140)).toBeCloseTo(
      playbackSecondsBetween(sparse, 3.5e9 - sparseWindow, 3.5e9),
      6,
    )
  })
})

describe('declutterCities', () => {
  const project = (positions: Record<string, readonly [number, number, number]>) => (c: CityAtTime) => positions[c.feature.id]!

  it('keeps sparse cities and thins a smaller neighbour of a larger one', () => {
    const sparse = project({ a: [0, 0, 0], b: [100, 0, 0], c: [-100, 0, 0] })
    expect(declutterCities([cityAt('a', 100), cityAt('b', 90), cityAt('c', 80)], sparse, 10)).toHaveLength(3)
    const dense = project({ big: [0, 0, 0], small: [1, 0, 0], far: [100, 0, 0] })
    expect(declutterCities([cityAt('big', 100), cityAt('small', 90), cityAt('far', 80)], dense, 10).map((c) => c.feature.id)).toEqual([
      'big',
      'far',
    ])
  })

  it('decides locally: a distant city never changes a close pair', () => {
    const positions = project({ a: [0, 0, 0], b: [1, 0, 0], c: [500, 0, 0] })
    expect(declutterCities([cityAt('a', 100), cityAt('b', 90), cityAt('c', 50)], positions, 10).map((c) => c.feature.id)).toEqual([
      'a',
      'c',
    ])
  })

  it('keeps everything at zero separation', () => {
    const cities = [cityAt('a', 100), cityAt('b', 90)]
    expect(declutterCities(cities, () => [0, 0, 0], 0)).toEqual(cities)
  })
})

describe('cityLocalPosition', () => {
  it('is pure in lon/lat/unfold and distinct per location', () => {
    const a = city('a', [{ t: 0, population: 1 }], 12, 34)
    const b = city('b', [{ t: 0, population: 1 }], 12, 35)
    for (const unfold of [0, 1]) {
      expect(cityLocalPosition(a, unfold)).toEqual(cityLocalPosition(a, unfold))
      expect(cityLocalPosition(a, unfold)).not.toEqual(cityLocalPosition(b, unfold))
    }
  })
})
