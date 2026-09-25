import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { humanDominance, stemGains } from './stemGains'
import { AMBIENCE_STEM_IDS, SCENE_STEM_IDS } from './stemIds'

const NONE: never[] = []
// Siberian and Deccan Traps windows, as engine.ts derives them from flood-basalt events.
const FLOOD_BASALT = [
  { tMin: 2.5e8, tMax: 2.54e8 },
  { tMin: 6.56e7, tMax: 6.63e7 },
]
const LIFE_AND_HUMAN = AMBIENCE_STEM_IDS.filter((id) => !['wind', 'water', 'storm', 'volcanic'].includes(id))
const WILDLIFE = ['forest', 'wing-hum', 'insects', 'birds', 'mammals', 'livestock'] as const

describe('stemGains', () => {
  it('returns exactly the ambience stems, never scene-only stems', () => {
    const gains = stemGains(6.6043e7, FLOOD_BASALT)
    expect(Object.keys(gains).sort()).toEqual([...AMBIENCE_STEM_IDS].sort())
    for (const id of SCENE_STEM_IDS) expect(id in gains).toBe(false)
  })

  it('keeps every stem within [0, 1] across a dense sweep, and is pure in t', () => {
    const sweep = [...Array.from({ length: 2001 }, (_, i) => (EARTH_FORMATION * i) / 2000), ...Array.from({ length: 301 }, (_, i) => i)]
    for (const t of sweep) {
      const gains = stemGains(t, FLOOD_BASALT)
      for (const id of AMBIENCE_STEM_IDS) {
        expect(gains[id] >= 0 && gains[id] <= 1, `${id} at t=${t}`).toBe(true)
      }
    }
    expect(stemGains(1.2e8, FLOOD_BASALT)).toEqual(stemGains(1.2e8, [...FLOOD_BASALT]))
  })

  it('is only the pre-land bed and volcanic before land life, volcanic receding with age', () => {
    const eras = [4.4e9, 3e9, 7e8, 4.8e8]
    for (const t of eras) {
      const gains = stemGains(t, NONE)
      expect(gains.wind).toBeGreaterThan(0.5)
      for (const id of LIFE_AND_HUMAN) expect(gains[id], `${id} at t=${t}`).toBe(0)
    }
    const volcanic = eras.map((t) => stemGains(t, NONE).volcanic)
    for (let i = 1; i < volcanic.length; i++) expect(volcanic[i]).toBeLessThan(volcanic[i - 1]!)
  })

  it('silences the pre-land bed once forests establish', () => {
    for (const t of [3.7e8, 3.0e8, 6.6043e7, 0]) {
      const gains = stemGains(t, NONE)
      expect([gains.wind, gains.water, gains.storm], `t=${t}`).toEqual([0, 0, 0])
    }
    expect(stemGains(3.46e8, NONE).forest).toBeGreaterThan(0.25)
  })

  it('voices each era with its own animals', () => {
    const cretaceous = stemGains(9.0e7, NONE)
    expect(cretaceous.archosaurs).toBeGreaterThan(0.3)
    expect(cretaceous.birds).toBe(0)
    const miocene = stemGains(1.2e7, NONE)
    expect(miocene.archosaurs).toBe(0)
    expect(miocene.mammals).toBeGreaterThan(0.2)
    expect(miocene.livestock).toBe(0)
    expect(stemGains(1.0e4, NONE).livestock).toBeGreaterThan(0.15)
    expect(stemGains(3.1e8, NONE).insects).toBe(0)
    expect(stemGains(2.9e8, NONE).insects).toBeGreaterThan(0)
  })

  it('keeps insects under the forest bed and recedes wildlife once cities stand', () => {
    for (const t of [2.9e8, 1.5e8, 3.0e7, 1.1e4]) {
      const gains = stemGains(t, NONE)
      expect(gains.insects, `t=${t}`).toBeLessThan(gains.forest)
    }
    const rome = stemGains(1.9e3, NONE)
    expect(Math.max(...WILDLIFE.filter((id) => id !== 'livestock').map((id) => rome[id]))).toBeLessThan(rome.settlement / 3)
  })

  it('makes traffic loudest at the present with wildlife ducked but not silenced', () => {
    const now = stemGains(0, NONE)
    for (const id of AMBIENCE_STEM_IDS) if (id !== 'traffic') expect(now.traffic, id).toBeGreaterThan(now[id])
    expect(Math.max(...WILDLIFE.map((id) => now[id]))).toBeLessThan(0.1)
    expect(now.forest).toBeGreaterThan(0)
    const millTown = stemGains(162, NONE)
    expect(millTown.industry).toBeGreaterThan(Math.max(...WILDLIFE.map((id) => millTown[id])))
    expect(millTown.traffic).toBe(0)
  })

  it('carries street traffic under the early motor-age street scenes but not the Somme between them', () => {
    const somme = stemGains(109, NONE).traffic
    for (const t of [112, 95]) expect(stemGains(t, NONE).traffic, `t=${t}`).toBeGreaterThan(somme + 0.35)
    expect(somme).toBeLessThan(0.1)
  })

  it('silences life through the K-Pg aftermath and recovers by 64.1 Ma', () => {
    expect(stemGains(6.6043e7, NONE).forest).toBeCloseTo(0.3, 2)
    const aftermath = stemGains(6.60429e7, NONE)
    expect(aftermath.forest).toBeLessThan(0.01)
    expect(aftermath.insects).toBeLessThan(0.01)
    expect(stemGains(6.41e7, NONE).forest).toBeCloseTo(0.3, 2)
  })

  it('spikes volcanic inside a flood-basalt window', () => {
    const baseline = stemGains(1.5e8, FLOOD_BASALT).volcanic
    expect(stemGains(2.52e8, FLOOD_BASALT).volcanic).toBeGreaterThan(baseline + 0.3)
    expect(stemGains(6.6e7, FLOOD_BASALT).volcanic).toBeGreaterThan(baseline + 0.3)
  })
})

describe('humanDominance', () => {
  it('is 0 before industry, 1 at present, and never decreases toward present', () => {
    expect(humanDominance(1.0e6)).toBe(0)
    expect(humanDominance(265)).toBe(0)
    expect(humanDominance(0)).toBeCloseTo(1, 10)
    let previous = humanDominance(300)
    for (let t = 299; t >= 0; t--) {
      expect(humanDominance(t)).toBeGreaterThanOrEqual(previous)
      previous = humanDominance(t)
    }
  })
})
