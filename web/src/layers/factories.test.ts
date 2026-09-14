import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'
import type { NodeValue } from '@/types/layer'

import { createEventsLayer, createNodeLayer, createScalarLayer } from './factories'
import {
  ANCESTOR_DATA,
  ANCESTOR_MANIFEST,
  CO2_DATA,
  CO2_MANIFEST,
  deepFreeze,
  GLOBE_REGIMES_DATA,
  GLOBE_REGIMES_MANIFEST,
  logSpace,
} from './fixtures'

describe('createScalarLayer', () => {
  it('is pure: repeated and interleaved sample() calls give deep-equal results', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)

    const a1 = layer.sample(5e7)
    const b1 = layer.sample(2e8)
    const a2 = layer.sample(5e7)
    const c1 = layer.sample(0)
    const b2 = layer.sample(2e8)
    const a3 = layer.sample(5e7)

    expect(a1).toEqual(a2)
    expect(a2).toEqual(a3)
    expect(b1).toEqual(b2)
    expect(c1).toEqual(layer.sample(0))
  })

  it('never mutates the frozen data it closes over', () => {
    const data = deepFreeze(structuredClone(CO2_DATA))
    const layer = createScalarLayer(CO2_MANIFEST, data)

    expect(() => {
      layer.sample(0)
      layer.sample(1e8)
      layer.sample(3e8)
      layer.sample(6e8) // out of domain
    }).not.toThrow()

    expect(data).toEqual(CO2_DATA)
  })

  it('shows ~277 ppm at t=0 from the fixture (not the raw 276.6 read as ~1)', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    const value = layer.sample(0)
    expect(value).not.toBeNull()
    expect(value?.unit).toBe('ppm')
    expect(value?.value).toBeCloseTo(276.6, 1)
    expect(Math.round(value?.value ?? 0)).toBe(277)
  })

  it('returns null outside the data domain, even though entry.timeDomain is wide open', () => {
    // CO2_MANIFEST.timeDomain is [0, EARTH_FORMATION] — wide open — so these nulls come from
    // CO2_DATA's own range (it ends at 5.7e8, the Phanerozoic boundary), not the manifest.
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    expect(layer.sample(6e8)).toBeNull()
    expect(layer.sample(4e9)).toBeNull()
  })

  it('returns null outside entry.timeDomain even when the data would otherwise cover t', () => {
    const narrowEntry = { ...CO2_MANIFEST, timeDomain: [0, 1e8] as [number, number] }
    const layer = createScalarLayer(narrowEntry, CO2_DATA)
    expect(layer.sample(5e7)).not.toBeNull()
    expect(layer.sample(2e8)).toBeNull() // within CO2_DATA's range but outside narrowEntry
  })
})

describe('createNodeLayer', () => {
  it('is pure: repeated and interleaved sample() calls give deep-equal results', () => {
    const layer = createNodeLayer(ANCESTOR_MANIFEST, ANCESTOR_DATA)

    const a1 = layer.sample(1e8)
    const b1 = layer.sample(1e9)
    const a2 = layer.sample(1e8)
    const c1 = layer.sample(3e5)
    const b2 = layer.sample(1e9)

    expect(a1).toEqual(a2)
    expect(b1).toEqual(b2)
    expect(c1).toEqual(layer.sample(3e5))
  })

  it('never mutates the frozen data it closes over', () => {
    const data = deepFreeze(structuredClone(ANCESTOR_DATA))
    const layer = createNodeLayer(ANCESTOR_MANIFEST, data)

    expect(() => {
      layer.sample(0)
      layer.sample(1e9)
      layer.sample(5e9) // out of domain
    }).not.toThrow()

    expect(data).toEqual(ANCESTOR_DATA)
  })

  it('returns null before the root has diverged', () => {
    const layer = createNodeLayer(ANCESTOR_MANIFEST, ANCESTOR_DATA)
    expect(layer.sample(4.3e9)).toBeNull() // older than LUCA's 4.2e9 tDivergence
  })

  it('returns null outside entry.timeDomain', () => {
    const narrowEntry = { ...ANCESTOR_MANIFEST, timeDomain: [0, 1e8] as [number, number] }
    const layer = createNodeLayer(narrowEntry, ANCESTOR_DATA)
    expect(layer.sample(5e7)).not.toBeNull()
    expect(layer.sample(2e8)).toBeNull()
  })

  it('yields at least 5 distinct nodes across a log-spaced scrub of the fixture tree', () => {
    const layer = createNodeLayer(ANCESTOR_MANIFEST, ANCESTOR_DATA)
    const scrubTimes = logSpace(1e5, 4.5e9, 24)
    const results = scrubTimes.map((t) => layer.sample(t))
    const distinctIds = new Set(results.flatMap((v): string[] => (v === null ? [] : [(v as NodeValue).id])))
    expect(distinctIds.size).toBeGreaterThanOrEqual(5)
  })

  it('EARTH_FORMATION stays inside the widest sensible timeDomain', () => {
    // sanity check on the fixture itself: the root's tDivergence must be < EARTH_FORMATION
    // so "older than any node" is reachable without leaving the valid GeoTime range.
    expect(ANCESTOR_DATA.nodes[ANCESTOR_DATA.nodes.length - 1]?.tDivergence).toBeLessThan(EARTH_FORMATION)
  })
})

describe('createEventsLayer', () => {
  it('is pure: repeated and interleaved sample() calls give deep-equal results', () => {
    const layer = createEventsLayer(GLOBE_REGIMES_MANIFEST, GLOBE_REGIMES_DATA)

    const a1 = layer.sample(4.4e9)
    const b1 = layer.sample(1.5e9)
    const a2 = layer.sample(4.4e9)
    const b2 = layer.sample(1.5e9)

    expect(a1).toEqual(a2)
    expect(b1).toEqual(b2)
  })

  it('never mutates the frozen data it closes over', () => {
    const data = deepFreeze(structuredClone(GLOBE_REGIMES_DATA))
    const layer = createEventsLayer(GLOBE_REGIMES_MANIFEST, data)

    expect(() => {
      layer.sample(4.4e9)
      layer.sample(3e9) // a gap between regimes
      layer.sample(6e9) // out of entry.timeDomain
    }).not.toThrow()

    expect(data).toEqual(GLOBE_REGIMES_DATA)
  })

  it('returns the active regime, effect included', () => {
    const layer = createEventsLayer(GLOBE_REGIMES_MANIFEST, GLOBE_REGIMES_DATA)
    const value = layer.sample(4.4e9)
    expect(value).toEqual({
      kind: 'events',
      events: [GLOBE_REGIMES_DATA.events[0]],
    })
  })

  it('returns an empty event list — not null — in a gap between regimes', () => {
    const layer = createEventsLayer(GLOBE_REGIMES_MANIFEST, GLOBE_REGIMES_DATA)
    expect(layer.sample(3e9)).toEqual({ kind: 'events', events: [] })
  })

  it('returns null outside entry.timeDomain', () => {
    const narrowEntry = { ...GLOBE_REGIMES_MANIFEST, timeDomain: [0, 1e8] as [number, number] }
    const layer = createEventsLayer(narrowEntry, GLOBE_REGIMES_DATA)
    expect(layer.sample(4.4e9)).toBeNull()
  })
})
