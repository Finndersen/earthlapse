import { describe, expect, it } from 'vitest'

import {
  budgetedDpr,
  centerOffset,
  clampedDollyDistance,
  clampPanTarget,
  fitDistance,
  globeBodyProxyHit,
  isSubFrameOf,
  logLerp,
  mapHasPanRoom,
  rayBoxIntersection,
  raySphereIntersection,
  sphereFitDistance,
  sphereRotateSpeedForDistance,
  sphereSilhouetteFraction,
  sphereViewFocus,
  subFrameFovY,
  unfoldCameraPose,
  type UnfoldViewEnds,
  zoomRatio,
} from './camera'
import { lonLatToMap, lonLatToSphere, unfoldedPosition, unrolledHalfHeight, unrolledHalfWidth } from './projection'

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

describe('sphereRotateSpeedForDistance', () => {
  const radius = 1

  it.each([
    [3.24, 0.6],
    [5, 0.25],
    [1.2, 0.05],
  ])(
    'reduces to exactly defaultRotateSpeed (%s -> %s) at distance === defaultDistance — the regression guard on the shipped default feel',
    (defaultDistance, defaultRotateSpeed) => {
      expect(sphereRotateSpeedForDistance(defaultDistance, radius, defaultDistance, defaultRotateSpeed)).toBeCloseTo(defaultRotateSpeed, 10)
    },
  )

  it('scales linearly with (distance - radius) away from the default', () => {
    const defaultDistance = 3.24
    const defaultRotateSpeed = 0.6
    const a = sphereRotateSpeedForDistance(2, radius, defaultDistance, defaultRotateSpeed) // distance - radius = 1
    const b = sphereRotateSpeedForDistance(3, radius, defaultDistance, defaultRotateSpeed) // distance - radius = 2
    expect(b).toBeCloseTo(a * 2, 10)
  })

  it('is far slower once zoomed in close than at the default distance, where a flat rotateSpeed ran away from the finger', () => {
    const defaultDistance = 3.24
    const defaultRotateSpeed = 0.6
    expect(sphereRotateSpeedForDistance(1.2, radius, defaultDistance, defaultRotateSpeed)).toBeLessThan(defaultRotateSpeed / 4)
  })

  it('stays positive and finite as distance approaches the radius (no min/maxDistance floor in sphere mode)', () => {
    const defaultDistance = 3.24
    const defaultRotateSpeed = 0.6
    expect(sphereRotateSpeedForDistance(radius, radius, defaultDistance, defaultRotateSpeed)).toBeGreaterThan(0)
    expect(sphereRotateSpeedForDistance(radius * 1.0001, radius, defaultDistance, defaultRotateSpeed)).toBeGreaterThan(0)
    expect(Number.isFinite(sphereRotateSpeedForDistance(radius * 0.5, radius, defaultDistance, defaultRotateSpeed))).toBe(true)
  })

  it('stays exactly defaultRotateSpeed even when defaultDistance itself is at the floor (distance === radius)', () => {
    // A degenerate but reachable configuration if the idle framing itself ever computed a
    // distance at or under the radius — the floor must apply identically to both distance terms
    // so the ratio, and so the anchor property above, still holds exactly.
    expect(sphereRotateSpeedForDistance(radius, radius, radius, 0.6)).toBeCloseTo(0.6, 10)
  })

  /**
   * Full-projection proof that the *scaling law* this function anchors preserves 1:1 finger
   * tracking away from a correctly-anchored default — independent of which fov the shipped
   * `defaultRotateSpeed` (0.6) was actually tuned against (this function's own doc comment on why
   * that is deliberately not assumed). `defaultRotateSpeed` here is instead the value that is
   * theoretically exact for the fov `Globe.tsx`'s `Canvas` actually renders the globe at (40°) —
   * computed once, independently, via the same closed form this function's own doc comment
   * derives — so this checks the *shape* of the anchoring formula, not a restatement of it.
   */
  describe('1:1 finger-tracking given a correctly-anchored default', () => {
    const fovYRadians = (40 * Math.PI) / 180
    const elementHeightPx = 800
    const defaultDistance = 3.24
    const defaultRotateSpeed = (Math.tan(fovYRadians / 2) * (defaultDistance - radius)) / (Math.PI * radius)

    /** Standard pinhole projection of `point` as seen by a camera at `cam`, looking at the world
     *  origin with world-up `(0, 1, 0)` — the same convention `OrbitControls` itself uses. */
    function screenX(cam: readonly [number, number, number], point: readonly [number, number, number]): number {
      const camLen = Math.hypot(cam[0], cam[1], cam[2])
      const forward: [number, number, number] = [-cam[0] / camLen, -cam[1] / camLen, -cam[2] / camLen]
      const worldUp: [number, number, number] = [0, 1, 0]
      const rx = forward[1] * worldUp[2] - forward[2] * worldUp[1]
      const ry = forward[2] * worldUp[0] - forward[0] * worldUp[2]
      const rz = forward[0] * worldUp[1] - forward[1] * worldUp[0]
      const rlen = Math.hypot(rx, ry, rz)
      const right: [number, number, number] = [rx / rlen, ry / rlen, rz / rlen]
      const v: [number, number, number] = [point[0] - cam[0], point[1] - cam[1], point[2] - cam[2]]
      const localX = v[0] * right[0] + v[1] * right[1] + v[2] * right[2]
      const depth = v[0] * forward[0] + v[1] * forward[1] + v[2] * forward[2]
      const focalLengthPx = elementHeightPx / (2 * Math.tan(fovYRadians / 2))
      return (focalLengthPx * localX) / depth
    }

    /** A camera orbited by `theta` about the world Y axis, starting at `(0, 0, distance)` — the
     *  same "camera moves, target/world stays fixed" convention `OrbitControls` itself uses. */
    function orbitedCamera(distance: number, theta: number): [number, number, number] {
      return [distance * Math.sin(theta), 0, distance * Math.cos(theta)]
    }

    /**
     * Independent, full-projection check of the "the point under the finger stays under the
     * finger" property — not a restatement of `sphereRotateSpeedForDistance`'s own formula.
     * Derives the OrbitControls rotation angle a `dragPx` drag produces at the returned
     * `rotateSpeed` (`OrbitControls`'s own `angle = 2*pi*rotateSpeed*deltaPx/elementHeightPx`),
     * applies it as a real camera orbit, and measures how far the sphere's own near-pole point
     * (fixed in world space, unlike the orbiting camera) actually moves on screen.
     */
    function measuredTrackingRatio(distance: number, dragPx: number): number {
      const rotateSpeed = sphereRotateSpeedForDistance(distance, radius, defaultDistance, defaultRotateSpeed)
      const theta = (2 * Math.PI * rotateSpeed * dragPx) / elementHeightPx
      const nearPole: [number, number, number] = [0, 0, radius]
      const before = orbitedCamera(distance, 0)
      const after = orbitedCamera(distance, theta)
      const shiftPx = screenX(after, nearPole) - screenX(before, nearPole)
      return Math.abs(shiftPx) / dragPx
    }

    // Distances span well zoomed-in to well zoomed-out from the default (3.24). The formula is a
    // first-order (small-rotation) calibration, so it drifts outside 10% only for a combination of
    // extreme zoom-out and a single very large accumulated drag — well past any drag a real touch
    // gesture produces at a size where the globe is still a meaningful target.
    it.each([1.05, 1.5, 2, 3.24, 5, 8])('keeps a 40px drag tracking the surface within 10%% at camera distance %s', (distance) => {
      const ratio = measuredTrackingRatio(distance, 40)
      expect(ratio).toBeGreaterThan(0.9)
      expect(ratio).toBeLessThan(1.1)
    })

    it.each([10, 25, 40, 80])('keeps a %spx drag tracking the surface within 10%% at the default camera distance', (dragPx) => {
      const ratio = measuredTrackingRatio(defaultDistance, dragPx)
      expect(ratio).toBeGreaterThan(0.9)
      expect(ratio).toBeLessThan(1.1)
    })
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

describe('centerOffset', () => {
  const canvas = { left: 0, top: 0, width: 1440, height: 900 }

  it('is zero on both axes when the target and canvas share a centre', () => {
    expect(centerOffset(canvas, canvas)).toEqual({ x: 0, y: 0 })
    expect(centerOffset({ left: 440, top: 170, width: 560, height: 560 }, canvas)).toEqual({ x: 0, y: 0 })
  })

  it('is negative for a target above or left of the canvas centre, positive below or right', () => {
    expect(centerOffset({ left: 440, top: 120, width: 560, height: 560 }, canvas)).toEqual({ x: 0, y: -50 })
    expect(centerOffset({ left: 440, top: 220, width: 560, height: 560 }, canvas)).toEqual({ x: 0, y: 50 })
    expect(centerOffset({ left: 300, top: 170, width: 560, height: 560 }, canvas)).toEqual({ x: -140, y: 0 })
    expect(centerOffset({ left: 600, top: 170, width: 560, height: 560 }, canvas)).toEqual({ x: 160, y: 0 })
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

describe('zoomRatio', () => {
  it('is 1 at the default height', () => {
    expect(zoomRatio(3.24, 3.24)).toBeCloseTo(1)
  })

  it('is 2 at half the default height (twice the on-screen scale)', () => {
    expect(zoomRatio(3.24, 1.62)).toBeCloseTo(2)
  })

  it('is 0.5 at twice the default height', () => {
    expect(zoomRatio(3.24, 6.48)).toBeCloseTo(0.5)
  })
})

describe('logLerp', () => {
  it('hits a exactly at t = 0', () => {
    expect(logLerp(2, 32, 0)).toBeCloseTo(2)
  })

  it('hits b exactly at t = 1', () => {
    expect(logLerp(2, 32, 1)).toBeCloseTo(32)
  })

  it('is the geometric mean at t = 0.5', () => {
    expect(logLerp(2, 32, 0.5)).toBeCloseTo(Math.sqrt(2 * 32))
  })

  it('works for a >  b (zooming in) too', () => {
    expect(logLerp(32, 2, 0)).toBeCloseTo(32)
    expect(logLerp(32, 2, 1)).toBeCloseTo(2)
    expect(logLerp(32, 2, 0.5)).toBeCloseTo(Math.sqrt(32 * 2))
  })
})

describe('sphereViewFocus', () => {
  it('faces lon 0 lat 0 for a camera on +Z with no globe rotation', () => {
    const focus = sphereViewFocus([0, 0, 3.24], 0)
    expect(focus.lon).toBeCloseTo(0, 9)
    expect(focus.lat).toBeCloseTo(0, 9)
  })

  it('faces lon 90 for a camera on +X with no globe rotation', () => {
    const focus = sphereViewFocus([3.24, 0, 0], 0)
    expect(focus.lon).toBeCloseTo(90, 9)
    expect(focus.lat).toBeCloseTo(0, 9)
  })

  /** Same convention `camera.ts`'s own internal `rotateY` uses (`Object3D.rotation.y`): a point at
   *  local lon `L` appears at world azimuth `L + r`. Reimplemented independently here rather than
   *  imported, so this test does not just restate the source's own helper. */
  function rotateAboutY(v: readonly [number, number, number], angle: number): [number, number, number] {
    const c = Math.cos(angle)
    const s = Math.sin(angle)
    return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
  }

  it('recovers the geographic point a camera sits over, for a rotated globe', () => {
    const cases: Array<{ point: { lat: number; lon: number }; rotation: number }> = [
      { point: { lat: 0, lon: 0 }, rotation: 0.7 },
      { point: { lat: 35, lon: -120 }, rotation: -1.9 },
      { point: { lat: -60, lon: 170 }, rotation: 4.1 },
      { point: { lat: 80, lon: 10 }, rotation: Math.PI },
    ]
    for (const { point, rotation } of cases) {
      const worldPosition = rotateAboutY(lonLatToSphere(point, 3.24), rotation)
      const focus = sphereViewFocus(worldPosition, rotation)
      expect(focus.lon).toBeCloseTo(point.lon, 6)
      expect(focus.lat).toBeCloseTo(point.lat, 6)
    }
  })
})

describe('unfoldCameraPose', () => {
  const fovYRadians = (40 * Math.PI) / 180
  const focus = { lat: 18, lon: -63 }
  const radius = 1

  function meshFitHeight(unfold: number): number {
    return fitDistance(unrolledHalfWidth(unfold), unrolledHalfHeight(unfold), 1.6, fovYRadians, 0.03)
  }

  function makeEnds(overrides: Partial<UnfoldViewEnds> = {}): UnfoldViewEnds {
    return {
      focus,
      globeRotationY: 0.6,
      radius,
      sphereHeight: 3.24,
      mapHeight: 5.5,
      mapTarget: lonLatToMap(focus, radius) as unknown as [number, number],
      meshFitHeight,
      ...overrides,
    }
  }

  /** Distance from point `p` to the closest point on segment `a`..`b`, and where along the segment
   *  (0 = a, 1 = b) that closest point falls — used to check "the ray from position towards target
   *  passes through X" without assuming any particular internal parameterisation. */
  function segmentDistanceAndParam(
    p: readonly [number, number, number],
    a: readonly [number, number, number],
    b: readonly [number, number, number],
  ): { distance: number; t: number } {
    const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ap: [number, number, number] = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
    const abLenSq = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]
    const t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / abLenSq
    const closest: [number, number, number] = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]
    return { distance: Math.hypot(p[0] - closest[0], p[1] - closest[1], p[2] - closest[2]), t }
  }

  it('at unfold 0: target is the origin, position is (radius + sphereHeight) along the world direction of focus, rotated by globeRotationY', () => {
    const ends = makeEnds()
    const { position, target } = unfoldCameraPose(0, ends)
    expect(target[0]).toBeCloseTo(0, 9)
    expect(target[1]).toBeCloseTo(0, 9)
    expect(target[2]).toBeCloseTo(0, 9)

    const c = Math.cos(ends.globeRotationY)
    const s = Math.sin(ends.globeRotationY)
    const [sx, sy, sz] = lonLatToSphere(focus)
    const worldDirection: [number, number, number] = [sx * c + sz * s, sy, -sx * s + sz * c]
    const expectedPosition = worldDirection.map((v) => v * (ends.radius + ends.sphereHeight))
    expect(position[0]).toBeCloseTo(expectedPosition[0]!, 9)
    expect(position[1]).toBeCloseTo(expectedPosition[1]!, 9)
    expect(position[2]).toBeCloseTo(expectedPosition[2]!, 9)
  })

  it('at unfold 1: target is [mapTarget, 0], position is [mapTarget, radius + mapHeight]', () => {
    const mapTarget: [number, number] = [0.4, -0.2]
    const ends = makeEnds({ mapTarget })
    const { position, target } = unfoldCameraPose(1, ends)
    expect(target[0]).toBeCloseTo(mapTarget[0], 9)
    expect(target[1]).toBeCloseTo(mapTarget[1], 9)
    expect(target[2]).toBeCloseTo(0, 9)
    expect(position[0]).toBeCloseTo(mapTarget[0], 9)
    expect(position[1]).toBeCloseTo(mapTarget[1], 9)
    expect(position[2]).toBeCloseTo(ends.radius + ends.mapHeight, 9)
  })

  it('with no pan offset, the ray from position through target passes through the rotated surface point at every unfold', () => {
    const ends = makeEnds() // mapTarget is exactly focus's own lonLatToMap point — no pan offset
    for (const unfold of [0, 0.1, 0.25, 0.5, 0.6, 0.75, 0.9, 1]) {
      const { position, target } = unfoldCameraPose(unfold, ends)
      const rotation = ends.globeRotationY * (1 - unfold)
      const c = Math.cos(rotation)
      const s = Math.sin(rotation)
      const [ux, uy, uz] = unfoldedPosition(focus, unfold, ends.radius)
      const rotated: [number, number, number] = [ux * c + uz * s, uy, -ux * s + uz * c]

      const { distance, t } = segmentDistanceAndParam(rotated, target, position)
      expect(distance).toBeLessThan(1e-9)
      expect(t).toBeGreaterThanOrEqual(-1e-9)
      expect(t).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  // FAILS as of this writing: at unfold 0.5 with focus {lat: 18, lon: -63}, globeRotationY 0.6,
  // sphereHeight 3.24, mapHeight 5.5 and mapTarget [0, 0] (the map's own centre, not focus's own
  // map point — a real pan offset), the measured distance is 4.19413 against a plainHeight floor
  // of 4.22137: a 0.0272 deficit, ~0.65% under the floor this behaviour is supposed to guarantee.
  // The offset vector (x/y only, added in `unfoldCameraPose`'s `along`) is not always orthogonal
  // to the surface normal at that unfold, so it can partially cancel the "along the normal" height
  // term instead of only ever adding to it — a pan large enough relative to the height at that
  // point pulls the camera closer to the surface than the plain logLerp floor promises.
  it('keeps the camera at least the plain logLerp height above the surface along its normal, with a pan offset in play', () => {
    const ends = makeEnds({ mapTarget: [0, 0] }) // map's centre, not focus's own map point: a real pan offset
    for (let i = 0; i <= 40; i++) {
      const unfold = i / 40
      const { position, target } = unfoldCameraPose(unfold, ends)
      const heightAlongNormal = Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) - ends.radius
      expect(heightAlongNormal).toBeGreaterThanOrEqual(logLerp(ends.sphereHeight, ends.mapHeight, unfold) - 1e-9)
    }
  })

  it.each([
    ['zoomed-in', 0.2, 0.6],
    ['default', 1.9, 4.0],
  ])('is continuous across the whole unfold range (%s case) — no jump in position bigger than a small bound', (_label, sphereHeight, mapHeight) => {
    const ends = makeEnds({ sphereHeight, mapHeight })
    const steps = 1000
    let prev = unfoldCameraPose(0, ends).position
    let maxJump = 0
    for (let i = 1; i <= steps; i++) {
      const unfold = i / steps
      const curr = unfoldCameraPose(unfold, ends).position
      const jump = Math.hypot(curr[0] - prev[0], curr[1] - prev[1], curr[2] - prev[2])
      maxJump = Math.max(maxJump, jump)
      prev = curr
    }
    expect(maxJump).toBeLessThan(0.05)
  })

  it('clamps unfold below 0 to behave as 0, and above 1 to behave as 1', () => {
    const ends = makeEnds()
    expect(unfoldCameraPose(-1, ends)).toEqual(unfoldCameraPose(0, ends))
    expect(unfoldCameraPose(-5, ends)).toEqual(unfoldCameraPose(0, ends))
    expect(unfoldCameraPose(2, ends)).toEqual(unfoldCameraPose(1, ends))
    expect(unfoldCameraPose(10, ends)).toEqual(unfoldCameraPose(1, ends))
  })
})

describe('sphereSilhouetteFraction', () => {
  it('puts the minimised orb’s limb at ≈0.892 of the half-height at distance 3.24 and fov 40°', () => {
    expect(sphereSilhouetteFraction(1, 3.24, 40)).toBeCloseTo(0.892, 3)
  })

  it('is the inverse of sphereFitDistance with no margin — a sphere fitted to the viewport fills it exactly', () => {
    const fovYRadians = (40 * Math.PI) / 180
    const distance = sphereFitDistance(1, 1, fovYRadians, 0)
    expect(sphereSilhouetteFraction(1, distance, 40)).toBeCloseTo(1, 10)
  })

  it('exceeds radius / distance, since the tangent points sit nearer the camera than the centre', () => {
    const naive = 1 / 3.24 / Math.tan((20 * Math.PI) / 180)
    expect(sphereSilhouetteFraction(1, 3.24, 40)).toBeGreaterThan(naive)
  })

  it('shrinks as the camera backs off', () => {
    expect(sphereSilhouetteFraction(1, 6, 40)).toBeLessThan(sphereSilhouetteFraction(1, 3, 40))
  })
})
