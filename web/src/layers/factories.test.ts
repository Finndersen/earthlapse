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

function frozen<T>(data: T): T {
  return deepFreeze(structuredClone(data))
}

const FACTORIES: [string, () => { sample: (t: number) => unknown; data: unknown }, unknown, number[]][] = [
  ['scalar', () => { const data = frozen(CO2_DATA); return { sample: createScalarLayer(CO2_MANIFEST, data).sample, data } }, CO2_DATA, [5e7, 2e8, 0, 6e8]],
  ['node', () => { const data = frozen(ANCESTOR_DATA); return { sample: createNodeLayer(ANCESTOR_MANIFEST, data).sample, data } }, ANCESTOR_DATA, [1e8, 1e9, 3e5, 5e9]],
  ['events', () => { const data = frozen(GLOBE_REGIMES_DATA); return { sample: createEventsLayer(GLOBE_REGIMES_MANIFEST, data).sample, data } }, GLOBE_REGIMES_DATA, [4.4e9, 1.5e9, 3e9, 6e9]],
]

describe.each(FACTORIES)('%s layer', (_kind, make, original, times) => {
  it('samples purely in t across interleaved calls, never mutating its frozen data', () => {
    const { sample, data } = make()
    const first = times.map((t) => sample(t))
    const again = [...times].reverse().map((t) => sample(t)).reverse()
    expect(again).toEqual(first)
    expect(times.map((t) => sample(t))).toEqual(first)
    expect(data).toEqual(original)
  })
})

describe('createScalarLayer', () => {
  it('samples ~427 ppm at the present', () => {
    const value = createScalarLayer(CO2_MANIFEST, CO2_DATA).sample(0)
    expect(value?.unit).toBe('ppm')
    expect(value?.value).toBeCloseTo(427.35, 1)
  })

  it('is null outside its data, inside a declared gap, or outside entry.timeDomain', () => {
    const layer = createScalarLayer(CO2_MANIFEST, CO2_DATA)
    expect(layer.sample(6e8)).toBeNull()
    expect(layer.sample(3.2e6)).toBeNull()
    expect(layer.sample(805_743.87)).not.toBeNull()
    const narrow = createScalarLayer({ ...CO2_MANIFEST, timeDomain: [0, 1e8] }, CO2_DATA)
    expect(narrow.sample(5e7)).not.toBeNull()
    expect(narrow.sample(2e8)).toBeNull()
  })
})

describe('createNodeLayer', () => {
  it('is null before the root and outside entry.timeDomain', () => {
    expect(createNodeLayer(ANCESTOR_MANIFEST, ANCESTOR_DATA).sample(4.3e9)).toBeNull()
    const narrow = createNodeLayer({ ...ANCESTOR_MANIFEST, timeDomain: [0, 1e8] }, ANCESTOR_DATA)
    expect(narrow.sample(5e7)).not.toBeNull()
    expect(narrow.sample(2e8)).toBeNull()
  })

  it('walks at least 5 distinct ancestors across a log-spaced scrub', () => {
    const layer = createNodeLayer(ANCESTOR_MANIFEST, ANCESTOR_DATA)
    const ids = logSpace(1e5, 4.5e9, 24).flatMap((t) => {
      const v = layer.sample(t) as NodeValue | null
      return v === null ? [] : [v.id]
    })
    expect(new Set(ids).size).toBeGreaterThanOrEqual(5)
    expect(ANCESTOR_DATA.nodes.at(-1)?.tDivergence).toBeLessThan(EARTH_FORMATION)
  })
})

describe('createEventsLayer', () => {
  it('returns active events, an empty list in a gap, and null outside entry.timeDomain', () => {
    const layer = createEventsLayer(GLOBE_REGIMES_MANIFEST, GLOBE_REGIMES_DATA)
    expect(layer.sample(4.4e9)).toEqual({ kind: 'events', events: [GLOBE_REGIMES_DATA.events[0]] })
    expect(layer.sample(3e9)).toEqual({ kind: 'events', events: [] })
    expect(createEventsLayer({ ...GLOBE_REGIMES_MANIFEST, timeDomain: [0, 1e8] }, GLOBE_REGIMES_DATA).sample(4.4e9)).toBeNull()
  })
})
