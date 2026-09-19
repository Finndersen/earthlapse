import { describe, expect, it } from 'vitest'

import { sameMarkers, type GlobeMarker } from './MarkerField'

// `sameMarkers` is the pure comparison the GPU-upload skip in `MarkerField`'s own effect is built
// on — unit-tested directly rather than through a mounted `<Canvas>`, matching this codebase's own
// convention of keeping logic testable without a canvas (see e.g. `arcs.ts`, `cities.ts`).

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
  it('is true for two distinct arrays holding equal markers in the same order — the fresh-array-every-frame case', () => {
    const a = [marker(), marker({ id: 'city:sydney-australia', lat: -33.86785, lon: 151.20732 })]
    const b = [marker(), marker({ id: 'city:sydney-australia', lat: -33.86785, lon: 151.20732 })]
    expect(a).not.toBe(b)
    expect(sameMarkers(a, b)).toBe(true)
  })

  it('is true for two empty arrays', () => {
    expect(sameMarkers([], [])).toBe(true)
  })

  it('is false when the length differs', () => {
    expect(sameMarkers([marker()], [marker(), marker({ id: 'extra' })])).toBe(false)
  })

  it('is false when marker order differs, even with the same markers present', () => {
    const a = [marker({ id: 'a' }), marker({ id: 'b' })]
    const b = [marker({ id: 'b' }), marker({ id: 'a' })]
    expect(sameMarkers(a, b)).toBe(false)
  })

  it.each([
    ['lat', { lat: 1 }],
    ['lon', { lon: 1 }],
    ['radiusPx', { radiusPx: 9 }],
    ['alpha', { alpha: 0.1 }],
    ['innerFraction', { innerFraction: 0.5 }],
    ['pulse', { pulse: 1 }],
  ] as const)('is false when only %s differs — a false "unchanged" would desync the GPU buffers from t', (_field, override) => {
    const a = [marker()]
    const b = [marker(override)]
    expect(sameMarkers(a, b)).toBe(false)
  })

  it('is false when only one channel of color differs', () => {
    const a = [marker({ color: [0.8, 0.6, 0.2] })]
    const b = [marker({ color: [0.8, 0.6, 0.9] })]
    expect(sameMarkers(a, b)).toBe(false)
  })
})
