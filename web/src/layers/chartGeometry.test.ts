import { describe, expect, it } from 'vitest'

import { createScalarLayer } from './factories'
import { defaultRange, fitValueRange, niceTicks, recentWindowsFor, sampleCurve, timeAxis, windowDomain } from './chartGeometry'

describe('timeAxis', () => {
  it('maps the oldest edge to 0 and the newest to 1, round-tripping in between, with ticks inside the span', () => {
    const axis = timeAxis([10, 4.8e8])
    expect(axis.toUnit(4.8e8)).toBeCloseTo(0)
    expect(axis.toUnit(10)).toBeCloseTo(1)
    expect(axis.fromUnit(axis.toUnit(21_000))).toBeCloseTo(21_000, 3)
    for (const { t } of axis.ticks()) {
      expect(t).toBeGreaterThanOrEqual(10)
      expect(t).toBeLessThanOrEqual(4.8e8)
    }
  })

  it('labels a span inside the Holocene with round calendar years', () => {
    expect(timeAxis([0, 200]).ticks().map((tick) => tick.label)).toEqual(['2000', '1950', '1900', '1850'])
  })
})

describe('recent windows', () => {
  it('offers only windows under half the record, each ending at its newest sample', () => {
    expect(recentWindowsFor([0, 4.8e8])).toEqual([25_000, 2_000, 200])
    expect(recentWindowsFor([10, 12_025])).toEqual([2_000, 200])
    expect(windowDomain([10, 12_025], 200)).toEqual([10, 200])
    expect(windowDomain([10, 12_025], null)).toEqual([10, 12_025])
  })

  it('opens a selection on the narrowest window holding its shortest record, else the whole span', () => {
    expect(defaultRange([25_000, 2_000, 200], [12_015, 4.8e8])).toBe(25_000)
    expect(defaultRange([25_000, 2_000, 200], [4.8e8])).toBeNull()
  })
})

describe('fitValueRange', () => {
  it('keeps zero as the floor for a count growing from near nothing, and fits a temperature to its own range', () => {
    expect(fitValueRange(4e6, 8e9, 'people')[0]).toBe(0)
    const [lo, hi] = fitValueRange(6, 36, '°C')
    expect(lo).toBeGreaterThan(4)
    expect(lo).toBeLessThan(6)
    expect(hi).toBeGreaterThan(36)
  })
})

describe('sampleCurve', () => {
  it('breaks the trace at a declared gap rather than bridging it', () => {
    const layer = createScalarLayer(
      { id: 'x', name: 'X', surface: 'hud', dataKind: 'scalar', timeDomain: [0, 100], source: 's', chartable: true, unit: 'u', interpolation: 'linear', data: 'x.json' },
      {
        id: 'x',
        unit: 'u',
        interpolation: 'linear',
        samples: [0, 40, 60, 100].map((t) => ({ t, value: t, lower: null, upper: null })),
        gaps: [{ fromIndex: 1, toIndex: 2 }],
      },
    )
    expect(sampleCurve(layer, timeAxis(layer.timeDomain), 100).runs).toHaveLength(2)
  })
})

describe('niceTicks', () => {
  it('spaces round-numbered ticks so about the asked-for count cover the range', () => {
    expect(niceTicks(10, 12_025, 5)).toEqual([2000, 4000, 6000, 8000, 10_000, 12_000])
  })
})
