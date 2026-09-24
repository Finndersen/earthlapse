import { describe, expect, it } from 'vitest'

import type { ArrivalGlobeEffect, FeatureData, TimelineEvent } from '@/types/layer'

import { buildArrivalIndex } from './arcs'
import { cityRadiusPx, type CityAtTime } from './cities'
import { cityLabelVisibility } from './GlobeLabel'
import { cityTarget, resolveTracedIds } from './HumanCivilisation'

const CAMERA: [number, number, number] = [0, 0, 3.6]
const ON_SCREEN: [number, number, number] = [0, 0, 0.5]

describe('cityLabelVisibility', () => {
  it('hides labels off-screen or behind the camera, even facing it', () => {
    for (const ndc of [[1.4, 0, 0.5], [0, -1.2, 0.5], [0, 0, 1.5]] as const) {
      expect(cityLabelVisibility([0, 0, 1], CAMERA, 1, 0, [...ndc])).toBe(0)
    }
  })

  it('applies the sphere limb test, fading through the horizon, only below unfold 0.5', () => {
    expect(cityLabelVisibility([0, 0, 1], CAMERA, 1, 0, ON_SCREEN)).toBe(1)
    expect(cityLabelVisibility([0, 0, -1], CAMERA, 1, 0, ON_SCREEN)).toBe(0)
    const a = Math.acos(1 / 3.6)
    const horizon = cityLabelVisibility([Math.sin(a), 0, Math.cos(a)], CAMERA, 1, 0, ON_SCREEN)
    expect(horizon).toBeGreaterThan(0)
    expect(horizon).toBeLessThan(1)
    expect(cityLabelVisibility([0, 0, -1], CAMERA, 1, 0.5, ON_SCREEN)).toBe(1)
  })
})

describe('cityTarget', () => {
  it("describes the attested record span, not a lifespan, even inside the trailing grace window", () => {
    const sanaa: FeatureData = {
      id: 'sanaa-yemen',
      name: "Sana'a",
      country: 'Yemen',
      lat: 15.35,
      lon: 44.21,
      certainty: 'high',
      estimates: [
        { t: 115, population: 18_000 },
        { t: 522, population: 5_000 },
      ],
    }
    const city: CityAtTime = { feature: sanaa, population: 18_000, radiusPx: cityRadiusPx(18_000), fade: 1 }
    expect(cityTarget(city, 81).dateRange).toBe('Records: 522 years ago – 115 years ago')
  })
})

describe('resolveTracedIds', () => {
  const ORIGIN: ArrivalGlobeEffect = {
    kind: 'arrival',
    arrivalKind: 'peopling',
    origin: { lat: 9.0, lon: 34.0 },
    destination: { lat: 9.0, lon: 34.0 },
    established: 3.15e5,
    windows: [{ tMin: 0, tMax: 3.15e5 }],
  }
  const DESCENDANT: ArrivalGlobeEffect = {
    kind: 'arrival',
    arrivalKind: 'peopling',
    origin: { lat: 9.0, lon: 34.0 },
    destination: { lat: 31.5, lon: 35.0 },
    established: 1.9e5,
    windows: [{ tMin: 0, tMax: 2.0e5 }],
  }
  function eventFor(id: string, effect: ArrivalGlobeEffect): TimelineEvent {
    return { id, label: id, tMin: effect.established, tMax: effect.windows[0]!.tMax, importance: 0.5, description: 'd', citation: 'c', effect }
  }
  const index = buildArrivalIndex([eventFor('origin', ORIGIN), eventFor('descendant', DESCENDANT)])

  it('returns one stable empty set when nothing is hovered', () => {
    const a = resolveTracedIds(index, null)
    const b = resolveTracedIds(index, null)
    expect(a).toBe(b)
    expect(a.size).toBe(0)
  })

  it('traces the chain for a hovered arrival', () => {
    const traced = resolveTracedIds(index, 'descendant')
    expect([...traced]).toEqual(['descendant', 'origin'])
  })
})
