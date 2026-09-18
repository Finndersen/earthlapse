import { describe, expect, it } from 'vitest'

import {
  budgetedDpr,
  clampedDollyDistance,
  clampPanTarget,
  fitDistance,
  globeBodyProxyHit,
  isSubFrameOf,
  mapHasPanRoom,
  rayBoxIntersection,
  raySphereIntersection,
  slerpDirection,
  sphereFitDistance,
  subFrameFovY,
  verticalCenterOffset,
} from './camera'

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

describe('subFrameFovY', () => {
  const fovYRadians = (40 * Math.PI) / 180

  it('returns the full FOV unchanged when the sub-frame is the whole canvas', () => {
    expect(subFrameFovY(fovYRadians, 900, 900)).toBeCloseTo(fovYRadians)
  })

  it('shrinks as the sub-frame shrinks relative to the canvas', () => {
    const half = subFrameFovY(fovYRadians, 450, 900)
    const quarter = subFrameFovY(fovYRadians, 225, 900)
    expect(half).toBeLessThan(fovYRadians)
    expect(quarter).toBeLessThan(half)
  })

  it('fitting an object against the sub-FOV at a given canvas height reproduces the sub-frame pixel size', () => {
    // Independent check of the whole point of this function: fit a unit sphere against a
    // 560px-tall sub-frame within a 900px-tall canvas, then verify the sphere's own apparent
    // radius, mapped through the *real* canvas height/FOV, lands on 560px * apparentTangent/tan(fovY/2)
    // — i.e. the sub-frame's own fraction of the canvas, not the whole canvas.
    const canvasHeightPx = 900
    const subHeightPx = 560
    const effectiveFovY = subFrameFovY(fovYRadians, subHeightPx, canvasHeightPx)
    const distance = sphereFitDistance(1, 1, effectiveFovY, 0)
    const apparentTangent = 1 / Math.sqrt(distance * distance - 1)
    const pixelsAtRealFov = canvasHeightPx * (apparentTangent / Math.tan(fovYRadians / 2))
    expect(pixelsAtRealFov).toBeCloseTo(subHeightPx, 5)
  })
})

describe('verticalCenterOffset', () => {
  it('is zero when the target and canvas share a centre', () => {
    expect(verticalCenterOffset(0, 900, 0, 900)).toBeCloseTo(0)
    expect(verticalCenterOffset(170, 560, 0, 900)).toBeCloseTo(0)
  })

  it('is positive when the target sits below the canvas centre', () => {
    // Target centred at y=400 (120..680), canvas centred at y=450 (0..900): target is above
    // centre here, so this should be negative — flip the target down to check the positive case.
    expect(verticalCenterOffset(120, 560, 0, 900)).toBeLessThan(0)
    expect(verticalCenterOffset(220, 560, 0, 900)).toBeGreaterThan(0)
  })
})

describe('mapHasPanRoom', () => {
  const fovYRadians = (40 * Math.PI) / 180
  const mapHalfWidth = 2.7
  const mapHalfHeight = 1.3

  it('is false at the fit distance — nothing to pan to when the whole map already fits', () => {
    const distance = fitDistance(mapHalfWidth, mapHalfHeight, 1.6, fovYRadians, 0.03)
    expect(mapHasPanRoom(distance, 1.6, fovYRadians, mapHalfWidth, mapHalfHeight)).toBe(false)
  })

  it('is true once zoomed in past the fit distance', () => {
    const distance = fitDistance(mapHalfWidth, mapHalfHeight, 1.6, fovYRadians, 0.03) / 2
    expect(mapHasPanRoom(distance, 1.6, fovYRadians, mapHalfWidth, mapHalfHeight)).toBe(true)
  })
})

describe('isSubFrameOf', () => {
  it('is false for null', () => {
    expect(isSubFrameOf(null, { width: 900, height: 900 })).toBe(false)
  })

  it('is false for a zero-height frame (the degenerate-measurement case)', () => {
    expect(isSubFrameOf({ width: 0, height: 0 }, { width: 900, height: 900 })).toBe(false)
  })

  it('is true for a frame genuinely smaller than the canvas on both axes', () => {
    expect(isSubFrameOf({ width: 570, height: 570 }, { width: 1440, height: 900 })).toBe(true)
  })

  it('is true at exact equality (a frame the same size as its canvas)', () => {
    expect(isSubFrameOf({ width: 900, height: 900 }, { width: 900, height: 900 })).toBe(true)
  })

  it('is false when the frame is taller than the canvas — the stale-canvas-size race this guards against', () => {
    // Reproduces the actual browser-verified bug: a correctly-measured ~570px fit frame arriving
    // before r3f's own canvas measurement has caught up from the minimised orb's small size.
    expect(isSubFrameOf({ width: 570, height: 570 }, { width: 250, height: 250 })).toBe(false)
  })

  it('is false when only the width exceeds the canvas', () => {
    expect(isSubFrameOf({ width: 1000, height: 500 }, { width: 900, height: 900 })).toBe(false)
  })
})

describe('budgetedDpr', () => {
  const BUDGET = 5_200_000

  it('returns the full device pixel ratio while the buffer is well under budget', () => {
    // The minimised orb, ~250px square: budget is nowhere near binding.
    expect(budgetedDpr(2, 250, 250, BUDGET)).toBeCloseTo(2)
  })

  it('returns the full device pixel ratio right at the reference viewport the budget was set from', () => {
    // 1440x900 at dpr 2 is exactly the ~5.2M px case this budget was measured against.
    expect(budgetedDpr(2, 1440, 900, BUDGET)).toBeCloseTo(2, 1)
  })

  it('tapers below the device pixel ratio once the buffer would exceed budget', () => {
    const dpr = budgetedDpr(2, 2560, 1440, BUDGET) // a ~5K-class viewport
    expect(dpr).toBeLessThan(2)
    expect(dpr).toBeGreaterThan(1)
  })

  it('bounds the resulting buffer at (approximately) the budget once tapering', () => {
    const width = 2560
    const height = 1440
    const dpr = budgetedDpr(2, width, height, BUDGET)
    const bufferPixels = width * dpr * height * dpr
    expect(bufferPixels).toBeLessThanOrEqual(BUDGET * 1.001)
  })

  it('never goes below 1 even for a huge viewport (no upscaling)', () => {
    expect(budgetedDpr(2, 8000, 4000, BUDGET)).toBeCloseTo(1)
  })

  it('never exceeds the display’s own device pixel ratio', () => {
    // A tiny buffer with a huge nominal device pixel ratio should still clamp to the device's own.
    expect(budgetedDpr(3, 100, 100, BUDGET)).toBeCloseTo(3)
  })

  it('is a no-op (always 1) on a non-retina display', () => {
    expect(budgetedDpr(1, 2560, 1440, BUDGET)).toBeCloseTo(1)
  })
})

describe('clampedDollyDistance', () => {
  it('scales by the factor within bounds', () => {
    expect(clampedDollyDistance(10, 0.8, 0, Infinity)).toBeCloseTo(8)
    expect(clampedDollyDistance(10, 1.25, 0, Infinity)).toBeCloseTo(12.5)
  })

  it('clamps to the minimum', () => {
    expect(clampedDollyDistance(10, 0.1, 2, Infinity)).toBeCloseTo(2)
  })

  it('clamps to the maximum', () => {
    expect(clampedDollyDistance(10, 5, 0, 20)).toBeCloseTo(20)
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

// Issue 1 (user verbatim: "clicking on the map or globe in fullscreen mode closes it") —
// `globeBodyProxyHit` and its two shape tests are `Globe.tsx`'s replacement for three.js's own
// broken default raycast against a mesh with no `position` attribute (`globeGeometry.ts`'s own
// doc comment); see that file's `mesh.raycast` doc comment for the full story.
describe('raySphereIntersection', () => {
  it('hits a sphere dead centre, from outside it', () => {
    const hit = raySphereIntersection([0, 0, 5], [0, 0, -1], 1)
    expect(hit).not.toBeNull()
    expect(hit![0]).toBeCloseTo(0)
    expect(hit![1]).toBeCloseTo(0)
    expect(hit![2]).toBeCloseTo(1)
  })

  it('misses a sphere the ray passes well clear of', () => {
    expect(raySphereIntersection([5, 5, 5], [0, 0, -1], 1)).toBeNull()
  })

  it('misses a sphere entirely behind the ray origin', () => {
    expect(raySphereIntersection([0, 0, -5], [0, 0, -1], 1)).toBeNull()
  })

  it('returns the near intersection point, not the far one, from outside the sphere', () => {
    const hit = raySphereIntersection([0, 0, 5], [0, 0, -1], 1)!
    // The near face (z = +1), not the far face (z = -1) the ray would exit through.
    expect(hit[2]).toBeCloseTo(1)
  })

  it('returns the exit point when the ray origin starts inside the sphere', () => {
    const hit = raySphereIntersection([0, 0, 0], [0, 0, -1], 1)!
    expect(hit[2]).toBeCloseTo(-1)
  })

  it('grazes the sphere at exactly the tangent point without reporting a miss', () => {
    const hit = raySphereIntersection([1, 0, 5], [0, 0, -1], 1)!
    expect(hit[0]).toBeCloseTo(1)
    expect(hit[1]).toBeCloseTo(0)
  })
})

describe('rayBoxIntersection', () => {
  const min: [number, number, number] = [-1, -1, 0.5]
  const max: [number, number, number] = [1, 1, 1.5]

  it('hits the box dead centre, from outside it along z', () => {
    const hit = rayBoxIntersection([0, 0, 5], [0, 0, -1], min, max)
    expect(hit).not.toBeNull()
    expect(hit![0]).toBeCloseTo(0)
    expect(hit![1]).toBeCloseTo(0)
    expect(hit![2]).toBeCloseTo(1.5)
  })

  it('misses a box the ray passes well clear of (both x and y outside the box)', () => {
    expect(rayBoxIntersection([5, 5, 5], [0, 0, -1], min, max)).toBeNull()
  })

  it('misses when the ray points away from the box entirely', () => {
    expect(rayBoxIntersection([0, 0, 5], [0, 0, 1], min, max)).toBeNull()
  })

  it('hits right at the box edge, not just its interior', () => {
    const hit = rayBoxIntersection([1, 1, 5], [0, 0, -1], min, max)
    expect(hit).not.toBeNull()
    expect(hit![2]).toBeCloseTo(1.5)
  })

  it('misses just past the box edge', () => {
    expect(rayBoxIntersection([1.001, 1.001, 5], [0, 0, -1], min, max)).toBeNull()
  })

  it('returns the exit face when the ray origin starts inside the box', () => {
    const hit = rayBoxIntersection([0, 0, 1], [0, 0, -1], min, max)!
    expect(hit[2]).toBeCloseTo(0.5)
  })
})

describe('globeBodyProxyHit', () => {
  const mapHalfWidth = 2.7
  const mapHalfHeight = 1.35
  const mapLocalHalfDepth = 0.05

  it('tests against the unit sphere below the 0.5 unfold midpoint', () => {
    // A point well outside the sphere (radius 1) but inside the map's own much wider footprint —
    // hits only once `unfold` crosses into map-shape territory.
    const origin: [number, number, number] = [2, 0, 5]
    const direction: [number, number, number] = [0, 0, -1]
    expect(globeBodyProxyHit(origin, direction, 0, mapHalfWidth, mapHalfHeight, mapLocalHalfDepth)).toBeNull()
    expect(globeBodyProxyHit(origin, direction, 0.49, mapHalfWidth, mapHalfHeight, mapLocalHalfDepth)).toBeNull()
  })

  it('tests against the map rectangle at and above the 0.5 unfold midpoint', () => {
    const origin: [number, number, number] = [2, 0, 5]
    const direction: [number, number, number] = [0, 0, -1]
    const hit = globeBodyProxyHit(origin, direction, 0.5, mapHalfWidth, mapHalfHeight, mapLocalHalfDepth)
    expect(hit).not.toBeNull()
    expect(hit![0]).toBeCloseTo(2)
    expect(hit![1]).toBeCloseTo(0)

    const hitAtOne = globeBodyProxyHit(origin, direction, 1, mapHalfWidth, mapHalfHeight, mapLocalHalfDepth)
    expect(hitAtOne).not.toBeNull()
  })

  it('hits dead centre at every unfold value — both shapes are centred on the same point', () => {
    const origin: [number, number, number] = [0, 0, 5]
    const direction: [number, number, number] = [0, 0, -1]
    for (const unfold of [0, 0.25, 0.5, 0.75, 1]) {
      expect(globeBodyProxyHit(origin, direction, unfold, mapHalfWidth, mapHalfHeight, mapLocalHalfDepth)).not.toBeNull()
    }
  })

  it('misses a point beyond both the sphere and the map footprint, at every unfold value', () => {
    const origin: [number, number, number] = [10, 10, 5]
    const direction: [number, number, number] = [0, 0, -1]
    for (const unfold of [0, 0.25, 0.5, 0.75, 1]) {
      expect(globeBodyProxyHit(origin, direction, unfold, mapHalfWidth, mapHalfHeight, mapLocalHalfDepth)).toBeNull()
    }
  })
})
