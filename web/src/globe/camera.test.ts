import { describe, expect, it } from 'vitest'

import { clampPanTarget, fitDistance, slerpDirection, sphereFitDistance } from './camera'

describe('fitDistance', () => {
  const fovYRadians = (40 * Math.PI) / 180

  it('is width-bound for a tall/narrow (phone) aspect — a narrow horizontal FOV needs more distance to fit the same width', () => {
    const tall = fitDistance(2.7, 1.3, 400 / 850, fovYRadians, 0)
    const halfFovX = Math.atan(Math.tan(fovYRadians / 2) * (400 / 850))
    const distanceForWidth = 2.7 / Math.tan(halfFovX)
    expect(tall).toBeCloseTo(distanceForWidth)
  })

  it('is height-bound for a wide aspect — the wide horizontal FOV already covers the width easily', () => {
    const wide = fitDistance(2.7, 1.3, 3, fovYRadians, 0)
    const distanceForHeight = 1.3 / Math.tan(fovYRadians / 2)
    expect(wide).toBeCloseTo(distanceForHeight)
  })

  it('grows with margin', () => {
    const noMargin = fitDistance(2.7, 1.3, 1.6, fovYRadians, 0)
    const withMargin = fitDistance(2.7, 1.3, 1.6, fovYRadians, 0.1)
    expect(withMargin).toBeGreaterThan(noMargin)
  })

  it('is always at least as large as either single-axis requirement', () => {
    const aspect = 1.9
    const distance = fitDistance(2.7, 1.3, aspect, fovYRadians, 0.05)
    const distanceForHeight = (1.3 * 1.05) / Math.tan(fovYRadians / 2)
    const halfFovX = Math.atan(Math.tan(fovYRadians / 2) * aspect)
    const distanceForWidth = (2.7 * 1.05) / Math.tan(halfFovX)
    expect(distance).toBeGreaterThanOrEqual(distanceForHeight - 1e-9)
    expect(distance).toBeGreaterThanOrEqual(distanceForWidth - 1e-9)
  })
})

describe('sphereFitDistance', () => {
  const fovYRadians = (40 * Math.PI) / 180

  it('reproduces the standard perspective sphere-fit formula at zero margin', () => {
    const radius = 1
    const distance = sphereFitDistance(radius, 1, fovYRadians, 0)
    // Independent derivation: the sphere's own apparent tangent radius at the returned distance
    // must exactly equal tan(halfFov) (the un-padded target) for a square (aspect 1) viewport.
    const apparentTangent = radius / Math.sqrt(distance * distance - radius * radius)
    expect(apparentTangent).toBeCloseTo(Math.tan(fovYRadians / 2))
  })

  it('grows with margin — more headroom needs more distance', () => {
    const noMargin = sphereFitDistance(1, 1, fovYRadians, 0)
    const withMargin = sphereFitDistance(1, 1, fovYRadians, 0.08)
    expect(withMargin).toBeGreaterThan(noMargin)
  })

  it('is width-bound for a tall/narrow aspect, matching the tighter horizontal half-fov', () => {
    const aspect = 400 / 850
    const distance = sphereFitDistance(1, aspect, fovYRadians, 0.08)
    const halfFovX = Math.atan(Math.tan(fovYRadians / 2) * aspect)
    const paddedTangent = Math.tan(halfFovX) / 1.08
    const expected = Math.sqrt(1 + 1 / (paddedTangent * paddedTangent))
    expect(distance).toBeCloseTo(expected)
  })

  it('scales linearly with radius', () => {
    const unit = sphereFitDistance(1, 1, fovYRadians, 0.08)
    const scaled = sphereFitDistance(2.5, 1, fovYRadians, 0.08)
    expect(scaled).toBeCloseTo(unit * 2.5)
  })
})

describe('clampPanTarget', () => {
  const fovYRadians = (40 * Math.PI) / 180
  const mapHalfWidth = 2.7
  const mapHalfHeight = 1.3

  it('locks to (near) the origin when the viewport already shows more than the whole map (zoomed out to the fit distance)', () => {
    const distance = fitDistance(mapHalfWidth, mapHalfHeight, 1.6, fovYRadians, 0)
    const clamped = clampPanTarget([5, 5], distance, 1.6, fovYRadians, mapHalfWidth, mapHalfHeight)
    // Floating-point roundoff in the trig above can leave an infinitesimal residual rather than
    // an exact 0 at precisely the fit distance — assert "effectively locked", not bit-exact.
    expect(Math.abs(clamped[0])).toBeLessThan(1e-9)
    expect(Math.abs(clamped[1])).toBeLessThan(1e-9)
  })

  it('allows panning up to the map edge once zoomed in, never past it', () => {
    const distance = fitDistance(mapHalfWidth, mapHalfHeight, 1.6, fovYRadians, 0) / 4 // zoomed in 4x
    const clamped = clampPanTarget([100, 100], distance, 1.6, fovYRadians, mapHalfWidth, mapHalfHeight)
    const visibleHalfHeight = distance * Math.tan(fovYRadians / 2)
    const visibleHalfWidth = visibleHalfHeight * 1.6
    expect(clamped[0]).toBeCloseTo(mapHalfWidth - visibleHalfWidth)
    expect(clamped[1]).toBeCloseTo(mapHalfHeight - visibleHalfHeight)
  })

  it('leaves an in-bounds target untouched', () => {
    const distance = fitDistance(mapHalfWidth, mapHalfHeight, 1.6, fovYRadians, 0) / 4
    const clamped = clampPanTarget([0.1, -0.05], distance, 1.6, fovYRadians, mapHalfWidth, mapHalfHeight)
    expect(clamped).toEqual([0.1, -0.05])
  })

  it('clamps negative targets symmetrically', () => {
    const distance = fitDistance(mapHalfWidth, mapHalfHeight, 1.6, fovYRadians, 0) / 4
    const clamped = clampPanTarget([-100, -100], distance, 1.6, fovYRadians, mapHalfWidth, mapHalfHeight)
    const [posX, posY] = clampPanTarget([100, 100], distance, 1.6, fovYRadians, mapHalfWidth, mapHalfHeight)
    expect(clamped).toEqual([-posX, -posY])
  })
})

describe('slerpDirection', () => {
  function length(v: readonly [number, number, number]): number {
    return Math.hypot(v[0], v[1], v[2])
  }

  it('returns a exactly at t=0 and b exactly at t=1 for two orthogonal directions', () => {
    const a: [number, number, number] = [1, 0, 0]
    const b: [number, number, number] = [0, 0, 1]
    const start = slerpDirection(a, b, 0)
    const end = slerpDirection(a, b, 1)
    expect(start[0]).toBeCloseTo(a[0])
    expect(start[1]).toBeCloseTo(a[1])
    expect(start[2]).toBeCloseTo(a[2])
    expect(end[0]).toBeCloseTo(b[0])
    expect(end[1]).toBeCloseTo(b[1])
    expect(end[2]).toBeCloseTo(b[2])
  })

  it('stays unit length and takes the great-circle midpoint for two orthogonal directions', () => {
    const a: [number, number, number] = [1, 0, 0]
    const b: [number, number, number] = [0, 0, 1]
    const mid = slerpDirection(a, b, 0.5)
    expect(length(mid)).toBeCloseTo(1)
    // Equidistant from both endpoints on the great circle between them, at 45 degrees each.
    expect(mid[0]).toBeCloseTo(Math.SQRT1_2)
    expect(mid[2]).toBeCloseTo(Math.SQRT1_2)
    expect(mid[1]).toBeCloseTo(0)
  })

  it('returns the input unchanged (identity, no NaN) when the two directions are identical', () => {
    const a: [number, number, number] = [0, 0, 1]
    const result = slerpDirection(a, a, 0.5)
    expect(result[0]).toBeCloseTo(a[0])
    expect(result[1]).toBeCloseTo(a[1])
    expect(result[2]).toBeCloseTo(a[2])
  })

  it('stays unit length and finite for antipodal directions, unlike a plain lerp+normalize (which passes through the zero vector)', () => {
    const a: [number, number, number] = [0, 0, 1]
    const b: [number, number, number] = [0, 0, -1]
    const mid = slerpDirection(a, b, 0.5)
    expect(Number.isFinite(mid[0])).toBe(true)
    expect(Number.isFinite(mid[1])).toBe(true)
    expect(Number.isFinite(mid[2])).toBe(true)
    expect(length(mid)).toBeCloseTo(1)
    // A plain lerp+normalize is undefined here (exactly the zero vector at t=0.5); this must not
    // collapse to zero.
    expect(length(mid)).toBeGreaterThan(0.5)
  })

  it('reaches a and b exactly at the endpoints even in the antipodal case', () => {
    const a: [number, number, number] = [0, 0, 1]
    const b: [number, number, number] = [0, 0, -1]
    const start = slerpDirection(a, b, 0)
    const end = slerpDirection(a, b, 1)
    expect(start[0]).toBeCloseTo(a[0])
    expect(start[1]).toBeCloseTo(a[1])
    expect(start[2]).toBeCloseTo(a[2])
    expect(end[0]).toBeCloseTo(b[0])
    expect(end[1]).toBeCloseTo(b[1])
    expect(end[2]).toBeCloseTo(b[2])
  })

  it('uses a different (but still valid, unit-length) rotation plane when the default up axis is itself antipodal to a', () => {
    // a === upAxisFallback's own antipode is the one case the primary cross product degenerates
    // for — the fallback cross product (against world +X) must still produce a sensible result.
    const a: [number, number, number] = [0, 1, 0]
    const b: [number, number, number] = [0, -1, 0]
    const mid = slerpDirection(a, b, 0.5, [0, 1, 0])
    expect(Number.isFinite(mid[0])).toBe(true)
    expect(Number.isFinite(mid[1])).toBe(true)
    expect(Number.isFinite(mid[2])).toBe(true)
    expect(length(mid)).toBeCloseTo(1)
  })

  it('clamps t outside [0, 1]', () => {
    const a: [number, number, number] = [1, 0, 0]
    const b: [number, number, number] = [0, 0, 1]
    const below = slerpDirection(a, b, -1)
    const above = slerpDirection(a, b, 2)
    expect(below[0]).toBeCloseTo(a[0])
    expect(above[2]).toBeCloseTo(b[2])
  })
})
