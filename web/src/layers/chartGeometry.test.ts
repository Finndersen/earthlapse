import { describe, expect, it } from 'vitest'

import { createScalarLayer } from './factories'
import { defaultTimeAxisKind, fitValueRange, niceTicks, sampleCurve, timeAxis } from './chartGeometry'

describe('timeAxis', () => {
  it.each(['linear', 'log'] as const)('maps the oldest edge to 0 and the newest to 1, round-tripping in between (%s)', (kind) => {
    const axis = timeAxis(kind, [10, 4.8e8])
    expect(axis.toUnit(4.8e8)).toBeCloseTo(0)
    expect(axis.toUnit(10)).toBeCloseTo(1)
    expect(axis.fromUnit(axis.toUnit(21_000))).toBeCloseTo(21_000, 3)
    for (const tick of axis.ticks()) {
      expect(tick).toBeGreaterThanOrEqual(10)
      expect(tick).toBeLessThanOrEqual(4.8e8)
    }
  })

  it('gives the last two centuries of a deep-time record visible width on a log axis', () => {
    const axis = timeAxis('log', [0, 4.8e8])
    expect(1 - axis.toUnit(200)).toBeGreaterThan(0.1)
  })

  it('defaults to log only for records spanning many orders of magnitude', () => {
    expect(defaultTimeAxisKind([0, 4.8e8])).toBe('log')
    expect(defaultTimeAxisKind([10, 12_025])).toBe('linear')
  })
})

describe('fitValueRange', () => {
  it('keeps zero as the floor for a count growing from near nothing, and fits anything else to its own range', () => {
    expect(fitValueRange(4e6, 8e9)[0]).toBe(0)
    const [lo, hi] = fitValueRange(11, 15)
    expect(lo).toBeGreaterThan(10)
    expect(lo).toBeLessThan(11)
    expect(hi).toBeGreaterThan(15)
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
    expect(sampleCurve(layer, timeAxis('linear', layer.timeDomain), 100).runs).toHaveLength(2)
  })
})

describe('niceTicks', () => {
  it('spaces round-numbered ticks so about the asked-for count cover the range', () => {
    expect(niceTicks(10, 12_025, 5)).toEqual([2000, 4000, 6000, 8000, 10_000, 12_000])
  })
})
