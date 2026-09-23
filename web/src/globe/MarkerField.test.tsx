import { describe, expect, it } from 'vitest'

import { sameMarkers, type GlobeMarker } from './MarkerField'

// `sameMarkers` gates MarkerField's GPU upload: a false "unchanged" desyncs the buffers from t.

function marker(overrides: Partial<GlobeMarker> = {}): GlobeMarker {
  return {
    id: 'city:sanaa-yemen',
    lat: 15.35472,
    lon: 44.20667,
    radiusPx: 4,
    color: [0.8, 0.6, 0.2],
    alpha: 0.9,
    innerFraction: 0,
    pulse: 0,
    ...overrides,
  }
}

describe('sameMarkers', () => {
  it('is true for distinct arrays of equal markers in the same order', () => {
    const make = () => [marker(), marker({ id: 'city:sydney', lat: -33.87, lon: 151.21 })]
    expect(sameMarkers(make(), make())).toBe(true)
    expect(sameMarkers([], [])).toBe(true)
  })

  it('is false for a different length or order', () => {
    expect(sameMarkers([marker()], [marker(), marker({ id: 'extra' })])).toBe(false)
    expect(sameMarkers([marker({ id: 'a' }), marker({ id: 'b' })], [marker({ id: 'b' }), marker({ id: 'a' })])).toBe(false)
  })

  it.each([
    ['lat', { lat: 1 }],
    ['pulse', { pulse: 1 }],
    ['one colour channel', { color: [0.8, 0.6, 0.9] as [number, number, number] }],
  ] as const)('is false when only %s differs', (_field, override) => {
    expect(sameMarkers([marker()], [marker(override)])).toBe(false)
  })
})
