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
  sphereViewFocus,
  subFrameFovY,
  unfoldCameraPose,
  type UnfoldViewEnds,
  zoomRatio,
} from './camera'
import { lonLatToMap, lonLatToSphere, unfoldedPosition, unrolledHalfHeight, unrolledHalfWidth } from './projection'

type Vec3 = [number, number, number]

const FOV_Y = (40 * Math.PI) / 180
const MAP_HALF_WIDTH = 2.7
const MAP_HALF_HEIGHT = 1.3

function rotateAboutY(v: readonly [number, number, number], angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}

describe('fitDistance', () => {
  it('is width-bound on a narrow aspect and height-bound on a wide one', () => {
    const halfFovX = Math.atan(Math.tan(FOV_Y / 2) * (400 / 850))
    expect(fitDistance(2.7, 1.3, 400 / 850, FOV_Y, 0)).toBeCloseTo(2.7 / Math.tan(halfFovX))
    expect(fitDistance(2.7, 1.3, 3, FOV_Y, 0)).toBeCloseTo(1.3 / Math.tan(FOV_Y / 2))
  })

  it('grows with margin', () => {
    expect(fitDistance(2.7, 1.3, 1.6, FOV_Y, 0.1)).toBeGreaterThan(fitDistance(2.7, 1.3, 1.6, FOV_Y, 0))
  })
})

describe('sphereFitDistance', () => {
  it('makes the sphere exactly fill the fov at zero margin, and scales with radius', () => {
    const distance = sphereFitDistance(1, 1, FOV_Y, 0)
    expect(1 / Math.sqrt(distance * distance - 1)).toBeCloseTo(Math.tan(FOV_Y / 2))
    expect(sphereFitDistance(2.5, 1, FOV_Y, 0.08)).toBeCloseTo(sphereFitDistance(1, 1, FOV_Y, 0.08) * 2.5)
  })

  it('is width-bound on a narrow aspect', () => {
    const halfFovX = Math.atan(Math.tan(FOV_Y / 2) * (400 / 850))
    const padded = Math.tan(halfFovX) / 1.08
    expect(sphereFitDistance(1, 400 / 850, FOV_Y, 0.08)).toBeCloseTo(Math.sqrt(1 + 1 / (padded * padded)))
  })
})

describe('subFrameFovY', () => {
  it('is the full fov for the whole canvas and shrinks with the sub-frame', () => {
    expect(subFrameFovY(FOV_Y, 900, 900)).toBeCloseTo(FOV_Y)
    expect(subFrameFovY(FOV_Y, 225, 900)).toBeLessThan(subFrameFovY(FOV_Y, 450, 900))
  })

  it('fits a sphere to the sub-frame pixel height at the real canvas fov', () => {
    const distance = sphereFitDistance(1, 1, subFrameFovY(FOV_Y, 560, 900), 0)
    const apparentTangent = 1 / Math.sqrt(distance * distance - 1)
    expect(900 * (apparentTangent / Math.tan(FOV_Y / 2))).toBeCloseTo(560, 5)
  })
})

describe('sphereRotateSpeedForDistance', () => {
  it('returns exactly the default speed at the default distance, including at the radius floor', () => {
    expect(sphereRotateSpeedForDistance(3.24, 1, 3.24, 0.6)).toBeCloseTo(0.6, 10)
    expect(sphereRotateSpeedForDistance(1, 1, 1, 0.6)).toBeCloseTo(0.6, 10)
  })

  it('scales linearly with height above the surface and stays positive and finite near it', () => {
    expect(sphereRotateSpeedForDistance(3, 1, 3.24, 0.6)).toBeCloseTo(sphereRotateSpeedForDistance(2, 1, 3.24, 0.6) * 2, 10)
    expect(sphereRotateSpeedForDistance(1, 1, 3.24, 0.6)).toBeGreaterThan(0)
    expect(Number.isFinite(sphereRotateSpeedForDistance(0.5, 1, 3.24, 0.6))).toBe(true)
  })

  describe('finger tracking given a correctly anchored default', () => {
    const heightPx = 800
    const defaultDistance = 3.24
    const defaultSpeed = (Math.tan(FOV_Y / 2) * (defaultDistance - 1)) / Math.PI

    function screenX(cam: Vec3, point: Vec3): number {
      const len = Math.hypot(...cam)
      const forward: Vec3 = [-cam[0] / len, -cam[1] / len, -cam[2] / len]
      const right: Vec3 = [-forward[2], 0, forward[0]]
      const rlen = Math.hypot(...right)
      const v: Vec3 = [point[0] - cam[0], point[1] - cam[1], point[2] - cam[2]]
      const localX = (v[0] * right[0] + v[2] * right[2]) / rlen
      const depth = v[0] * forward[0] + v[1] * forward[1] + v[2] * forward[2]
      return ((heightPx / (2 * Math.tan(FOV_Y / 2))) * localX) / depth
    }

    function trackingRatio(distance: number, dragPx: number): number {
      const speed = sphereRotateSpeedForDistance(distance, 1, defaultDistance, defaultSpeed)
      const theta = (2 * Math.PI * speed * dragPx) / heightPx
      const shift = screenX([distance * Math.sin(theta), 0, distance * Math.cos(theta)], [0, 0, 1]) - screenX([0, 0, distance], [0, 0, 1])
      return Math.abs(shift) / dragPx
    }

    it.each([
      [1.05, 40],
      [3.24, 10],
      [3.24, 80],
      [8, 40],
    ])('keeps the surface under the finger within 10%% at distance %s, drag %spx', (distance, dragPx) => {
      const ratio = trackingRatio(distance, dragPx)
      expect(ratio).toBeGreaterThan(0.9)
      expect(ratio).toBeLessThan(1.1)
    })
  })
})

describe('map pan limits', () => {
  const fit = fitDistance(MAP_HALF_WIDTH, MAP_HALF_HEIGHT, 1.6, FOV_Y, 0)
  const clamp = (target: [number, number], distance: number) =>
    clampPanTarget(target, distance, 1.6, FOV_Y, MAP_HALF_WIDTH, MAP_HALF_HEIGHT)

  it('locks to the origin at the fit distance and reports no pan room', () => {
    const clamped = clamp([5, 5], fit)
    expect(Math.abs(clamped[0])).toBeLessThan(1e-9)
    expect(Math.abs(clamped[1])).toBeLessThan(1e-9)
    const fitWithMargin = fitDistance(MAP_HALF_WIDTH, MAP_HALF_HEIGHT, 1.6, FOV_Y, 0.03)
    expect(mapHasPanRoom(fitWithMargin, 1.6, FOV_Y, MAP_HALF_WIDTH, MAP_HALF_HEIGHT)).toBe(false)
    expect(mapHasPanRoom(fitWithMargin / 2, 1.6, FOV_Y, MAP_HALF_WIDTH, MAP_HALF_HEIGHT)).toBe(true)
  })

  it('pans up to the map edge symmetrically once zoomed in, leaving in-bounds targets alone', () => {
    const distance = fit / 4
    const visibleHalfHeight = distance * Math.tan(FOV_Y / 2)
    const [x, y] = clamp([100, 100], distance)
    expect(x).toBeCloseTo(MAP_HALF_WIDTH - visibleHalfHeight * 1.6)
    expect(y).toBeCloseTo(MAP_HALF_HEIGHT - visibleHalfHeight)
    expect(clamp([-100, -100], distance)).toEqual([-x, -y])
    expect(clamp([0.1, -0.05], distance)).toEqual([0.1, -0.05])
  })
})

describe('centerOffset', () => {
  it('is signed from the canvas centre', () => {
    const canvas = { left: 0, top: 0, width: 1440, height: 900 }
    expect(centerOffset({ left: 440, top: 170, width: 560, height: 560 }, canvas)).toEqual({ x: 0, y: 0 })
    expect(centerOffset({ left: 300, top: 120, width: 560, height: 560 }, canvas)).toEqual({ x: -140, y: -50 })
    expect(centerOffset({ left: 600, top: 220, width: 560, height: 560 }, canvas)).toEqual({ x: 160, y: 50 })
  })
})

describe('isSubFrameOf', () => {
  it.each([
    [null, { width: 900, height: 900 }, false],
    [{ width: 0, height: 0 }, { width: 900, height: 900 }, false],
    [{ width: 570, height: 570 }, { width: 1440, height: 900 }, true],
    [{ width: 900, height: 900 }, { width: 900, height: 900 }, true],
    [{ width: 570, height: 570 }, { width: 250, height: 250 }, false],
    [{ width: 1000, height: 500 }, { width: 900, height: 900 }, false],
  ])('%o within %o is %s', (frame, canvas, expected) => {
    expect(isSubFrameOf(frame, canvas)).toBe(expected)
  })
})

describe('budgetedDpr', () => {
  const BUDGET = 5_200_000

  it('keeps the device ratio under budget and never exceeds it', () => {
    expect(budgetedDpr(2, 250, 250, BUDGET)).toBeCloseTo(2)
    expect(budgetedDpr(2, 1440, 900, BUDGET)).toBeCloseTo(2, 1)
    expect(budgetedDpr(3, 100, 100, BUDGET)).toBeCloseTo(3)
    expect(budgetedDpr(1, 2560, 1440, BUDGET)).toBeCloseTo(1)
  })

  it('tapers to hold the buffer at the budget, never below 1', () => {
    const dpr = budgetedDpr(2, 2560, 1440, BUDGET)
    expect(dpr).toBeLessThan(2)
    expect(2560 * dpr * 1440 * dpr).toBeLessThanOrEqual(BUDGET * 1.001)
    expect(budgetedDpr(2, 8000, 4000, BUDGET)).toBeCloseTo(1)
  })
})

describe('zoom helpers', () => {
  it('clampedDollyDistance scales within bounds', () => {
    expect(clampedDollyDistance(10, 0.8, 0, Infinity)).toBeCloseTo(8)
    expect(clampedDollyDistance(10, 0.1, 2, Infinity)).toBeCloseTo(2)
    expect(clampedDollyDistance(10, 5, 0, 20)).toBeCloseTo(20)
  })

  it('zoomRatio is inverse to height', () => {
    expect(zoomRatio(3.24, 3.24)).toBeCloseTo(1)
    expect(zoomRatio(3.24, 1.62)).toBeCloseTo(2)
  })

  it('logLerp hits both ends and the geometric mean, in either direction', () => {
    expect(logLerp(2, 32, 0)).toBeCloseTo(2)
    expect(logLerp(2, 32, 1)).toBeCloseTo(32)
    expect(logLerp(2, 32, 0.5)).toBeCloseTo(8)
    expect(logLerp(32, 2, 0.5)).toBeCloseTo(8)
  })
})

describe('ray intersections', () => {
  it('raySphereIntersection returns the near hit from outside, the exit from inside, null on a miss', () => {
    expect(raySphereIntersection([0, 0, 5], [0, 0, -1], 1)![2]).toBeCloseTo(1)
    expect(raySphereIntersection([0, 0, 0], [0, 0, -1], 1)![2]).toBeCloseTo(-1)
    expect(raySphereIntersection([1, 0, 5], [0, 0, -1], 1)![0]).toBeCloseTo(1)
    expect(raySphereIntersection([5, 5, 5], [0, 0, -1], 1)).toBeNull()
    expect(raySphereIntersection([0, 0, -5], [0, 0, -1], 1)).toBeNull()
  })

  it('rayBoxIntersection hits faces and edges, and misses just past them', () => {
    const min: Vec3 = [-1, -1, 0.5]
    const max: Vec3 = [1, 1, 1.5]
    expect(rayBoxIntersection([0, 0, 5], [0, 0, -1], min, max)![2]).toBeCloseTo(1.5)
    expect(rayBoxIntersection([1, 1, 5], [0, 0, -1], min, max)![2]).toBeCloseTo(1.5)
    expect(rayBoxIntersection([0, 0, 1], [0, 0, -1], min, max)![2]).toBeCloseTo(0.5)
    expect(rayBoxIntersection([1.001, 1.001, 5], [0, 0, -1], min, max)).toBeNull()
    expect(rayBoxIntersection([0, 0, 5], [0, 0, 1], min, max)).toBeNull()
  })

  it('globeBodyProxyHit switches from sphere to map rectangle at unfold 0.5', () => {
    const hit = (origin: Vec3, unfold: number) => globeBodyProxyHit(origin, [0, 0, -1], unfold, 2.7, 1.35, 0.05)
    expect(hit([2, 0, 5], 0.49)).toBeNull()
    expect(hit([2, 0, 5], 0.5)![0]).toBeCloseTo(2)
    expect(hit([2, 0, 5], 1)).not.toBeNull()
    for (const unfold of [0, 0.5, 1]) {
      expect(hit([0, 0, 5], unfold)).not.toBeNull()
      expect(hit([10, 10, 5], unfold)).toBeNull()
    }
  })
})

describe('sphereViewFocus', () => {
  it.each([
    [{ lat: 0, lon: 0 }, 0],
    [{ lat: 0, lon: 90 }, 0],
    [{ lat: 35, lon: -120 }, -1.9],
    [{ lat: 80, lon: 10 }, Math.PI],
  ])('recovers %o under globe rotation %s', (point, rotation) => {
    const focus = sphereViewFocus(rotateAboutY(lonLatToSphere(point, 3.24), rotation), rotation)
    expect(focus.lon).toBeCloseTo(point.lon, 6)
    expect(focus.lat).toBeCloseTo(point.lat, 6)
  })
})

describe('unfoldCameraPose', () => {
  const focus = { lat: 18, lon: -63 }

  function ends(overrides: Partial<UnfoldViewEnds> = {}): UnfoldViewEnds {
    return {
      focus,
      globeRotationY: 0.6,
      radius: 1,
      sphereHeight: 3.24,
      mapHeight: 5.5,
      mapTarget: lonLatToMap(focus, 1) as unknown as [number, number],
      meshFitHeight: (u) => fitDistance(unrolledHalfWidth(u), unrolledHalfHeight(u), 1.6, FOV_Y, 0.03),
      ...overrides,
    }
  }

  it('orbits the origin over the rotated focus at unfold 0', () => {
    const e = ends()
    const { position, target } = unfoldCameraPose(0, e)
    target.forEach((v) => expect(v).toBeCloseTo(0, 9))
    const expected = rotateAboutY(lonLatToSphere(focus), e.globeRotationY).map((v) => v * (e.radius + e.sphereHeight))
    position.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 9))
  })

  it('looks straight down at mapTarget at unfold 1', () => {
    const e = ends({ mapTarget: [0.4, -0.2] })
    const { position, target } = unfoldCameraPose(1, e)
    expect([...target]).toEqual([expect.closeTo(0.4, 9), expect.closeTo(-0.2, 9), expect.closeTo(0, 9)])
    expect([...position]).toEqual([expect.closeTo(0.4, 9), expect.closeTo(-0.2, 9), expect.closeTo(6.5, 9)])
  })

  it('keeps the focus point on the view ray at every unfold without a pan offset', () => {
    const e = ends()
    for (const unfold of [0, 0.25, 0.5, 0.75, 1]) {
      const { position: b, target: a } = unfoldCameraPose(unfold, e)
      const p = rotateAboutY(unfoldedPosition(focus, unfold, e.radius), e.globeRotationY * (1 - unfold))
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
      const t = (ap[0]! * ab[0]! + ap[1]! * ab[1]! + ap[2]! * ab[2]!) / (ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2)
      expect(Math.hypot(ap[0]! - ab[0]! * t, ap[1]! - ab[1]! * t, ap[2]! - ab[2]! * t)).toBeLessThan(1e-9)
      expect(t).toBeGreaterThanOrEqual(-1e-9)
      expect(t).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('stays at least the logLerp height above the surface with a pan offset', () => {
    const e = ends({ mapTarget: [0, 0] })
    for (let i = 0; i <= 40; i++) {
      const { position, target } = unfoldCameraPose(i / 40, e)
      const height = Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) - e.radius
      expect(height).toBeGreaterThanOrEqual(logLerp(e.sphereHeight, e.mapHeight, i / 40) - 1e-9)
    }
  })

  it.each([
    [0.2, 0.6],
    [1.9, 4.0],
  ])('moves continuously across the unfold range (heights %s → %s)', (sphereHeight, mapHeight) => {
    const e = ends({ sphereHeight, mapHeight })
    let prev = unfoldCameraPose(0, e).position
    for (let i = 1; i <= 1000; i++) {
      const curr = unfoldCameraPose(i / 1000, e).position
      expect(Math.hypot(curr[0] - prev[0], curr[1] - prev[1], curr[2] - prev[2])).toBeLessThan(0.05)
      prev = curr
    }
  })

  it('clamps unfold to [0, 1]', () => {
    const e = ends()
    expect(unfoldCameraPose(-5, e)).toEqual(unfoldCameraPose(0, e))
    expect(unfoldCameraPose(10, e)).toEqual(unfoldCameraPose(1, e))
  })
})
