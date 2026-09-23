import { describe, expect, it } from 'vitest'

import { anchorUv } from './effects/overlays'
import {
  EQUAL_EARTH_A1,
  EQUAL_EARTH_A2,
  EQUAL_EARTH_A3,
  EQUAL_EARTH_A4,
  EQUAL_EARTH_HALF_HEIGHT,
  EQUAL_EARTH_HALF_WIDTH,
  EQUAL_EARTH_M,
  lonLatToMap,
  lonLatToSphere,
  mapToLonLat,
  PROJECTION_GLSL,
  sphereToLonLat,
  splitAtAntimeridian,
  unfoldedLiftedPosition,
  unfoldedNormal,
  unfoldedPosition,
  unrolledHalfHeight,
  unrolledHalfWidth,
} from './projection'

type Vec3 = readonly [number, number, number]

function expectContinuous(f: (unfold: number) => Vec3, steps = 400): void {
  let prev = f(0)
  for (let i = 1; i <= steps; i++) {
    const curr = f(i / steps)
    expect(Math.hypot(curr[0] - prev[0], curr[1] - prev[1], curr[2] - prev[2])).toBeLessThan(0.05)
    prev = curr
  }
}

describe('lonLatToSphere', () => {
  it('puts poles on ±Y, lon 0 on +Z, east on +X, and scales by radius', () => {
    expect(lonLatToSphere({ lat: 90, lon: 0 })[1]).toBeCloseTo(1)
    expect(lonLatToSphere({ lat: -90, lon: 0 })[1]).toBeCloseTo(-1)
    const [x, y, z] = lonLatToSphere({ lat: 0, lon: 0 }, 2.5)
    expect([x, y, z]).toEqual([expect.closeTo(0), expect.closeTo(0), expect.closeTo(2.5)])
    expect(lonLatToSphere({ lat: 0, lon: 90 })[0]).toBeGreaterThan(0)
  })

  it('renders east of the facing longitude to the viewer’s right', () => {
    const eye = lonLatToSphere({ lat: 0, lon: 50 }, 3.6)
    const len = Math.hypot(...eye)
    // right = up × backward, with up = +Y
    const right: Vec3 = [eye[2] / len, 0, -eye[0] / len]
    const screenX = (p: Vec3) => p[0] * right[0] + p[2] * right[2]
    expect(screenX(lonLatToSphere({ lat: 20, lon: 78 }))).toBeGreaterThan(screenX(lonLatToSphere({ lat: 0, lon: 20 })))
  })

  it('agrees with the overlay uv shortcut', () => {
    const uv = anchorUv({ lat: 21.3, lon: -89.5 })
    expect(uv.u).toBeCloseTo(0.5 - 89.5 / 360, 6)
    expect(uv.v).toBeCloseTo(0.5 - 21.3 / 180, 6)
  })
})

describe('sphereToLonLat', () => {
  it('inverts lonLatToSphere across a grid, for any vector length', () => {
    for (const lon of [-179.9, -90, 0, 45, 179.9]) {
      for (const lat of [-89.9, -30, 0, 60, 89.9]) {
        const [x, y, z] = lonLatToSphere({ lat, lon })
        for (const k of [1, 4.7]) {
          const back = sphereToLonLat([x * k, y * k, z * k])
          expect(back.lon).toBeCloseTo(lon, 9)
          expect(back.lat).toBeCloseTo(lat, 9)
        }
      }
    }
  })
})

describe('lonLatToMap / mapToLonLat', () => {
  it('is a flat Equal Earth map centred on 0°, symmetric, east and north positive', () => {
    expect(EQUAL_EARTH_HALF_WIDTH).toBeCloseTo(2.707, 2)
    expect(EQUAL_EARTH_HALF_HEIGHT).toBeCloseTo(1.317, 2)
    expect(lonLatToMap({ lat: 0, lon: 0 }).slice(0, 2)).toEqual([expect.closeTo(0), expect.closeTo(0)])
    expect(lonLatToMap({ lat: -12, lon: 140 })[2]).toBe(0)
    expect(lonLatToMap({ lat: 30, lon: 90 })[0]).toBeCloseTo(-lonLatToMap({ lat: 30, lon: -90 })[0])
    expect(lonLatToMap({ lat: 40, lon: 20 })[1]).toBeCloseTo(-lonLatToMap({ lat: -40, lon: 20 })[1])
    const xs = [-80, 20, 100].map((lon) => lonLatToMap({ lat: 10, lon })[0])
    expect(xs[0]).toBeLessThan(xs[1]!)
    expect(xs[1]).toBeLessThan(xs[2]!)
    expect(lonLatToMap({ lat: 60, lon: 0 })[1]).toBeGreaterThan(0)
    expect(Math.abs(lonLatToMap({ lat: 90, lon: 180 })[0])).toBeLessThan(EQUAL_EARTH_HALF_WIDTH)
  })

  it('inverts across the whole map, including poles, edges and non-unit radius', () => {
    for (const lon of [-180, -179.9, -45, 0, 1, 90, 179.9, 180]) {
      for (const lat of [-89.9, -60, 0, 1, 85, 89.9]) {
        for (const radius of [1, 2]) {
          const [x, y] = lonLatToMap({ lat, lon }, radius)
          const back = mapToLonLat(x, y, radius)
          expect(Math.abs(back.lon - lon)).toBeLessThan(1e-9)
          expect(Math.abs(back.lat - lat)).toBeLessThan(1e-9)
        }
      }
    }
  })

  it.each([
    [100, 100],
    [1e6, -1e6],
  ])('clamps an off-map point (%s, %s) to a finite lon/lat', (x, y) => {
    const back = mapToLonLat(x, y)
    expect(Math.abs(back.lat)).toBeLessThanOrEqual(90)
    expect(Math.abs(back.lon)).toBeLessThanOrEqual(180)
  })
})

describe('unfoldedPosition', () => {
  const point = { lat: 12, lon: -140 }

  it('is the sphere at 0 and the map at z = radius at 1, clamped outside', () => {
    unfoldedPosition(point, 0).forEach((v, i) => expect(v).toBeCloseTo(lonLatToSphere(point)[i]!, 10))
    const [x, y, z] = unfoldedPosition(point, 1, 2)
    const [mx, my] = lonLatToMap(point, 2)
    expect([x, y, z]).toEqual([expect.closeTo(mx, 10), expect.closeTo(my, 10), expect.closeTo(2, 10)])
    expect(unfoldedPosition(point, -1)).toEqual(unfoldedPosition(point, 0))
    expect(unfoldedPosition(point, 2)).toEqual(unfoldedPosition(point, 1))
  })

  it('keeps the centre point fixed at (0, 0, radius)', () => {
    for (const unfold of [0, 0.25, 0.5, 0.999, 1]) {
      unfoldedPosition({ lat: 0, lon: 0 }, unfold, 3).forEach((v, i) => expect(v).toBeCloseTo([0, 0, 3][i]!, 9))
    }
  })

  it('moves continuously and stays finite as curvature reaches 0', () => {
    expectContinuous((u) => unfoldedPosition(point, u))
    for (const unfold of [0.9999, 1 - 1e-9, 1]) {
      for (const v of unfoldedPosition(point, unfold)) expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('spreads equatorial points smoothly mid-unfold rather than faceting', () => {
    const radii = [0, 30, 60, 90, 120, 150, 179].map((lon) => {
      const [x, , z] = unfoldedPosition({ lat: 0, lon }, 0.5)
      return Math.hypot(x, z)
    })
    for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]!)
  })
})

describe('unrolledHalfWidth / unrolledHalfHeight', () => {
  it('runs from the sphere silhouette to the Equal Earth extents, scaling with radius', () => {
    expect(unrolledHalfWidth(0, 2)).toBeCloseTo(2, 6)
    expect(unrolledHalfHeight(0, 2)).toBeCloseTo(2, 6)
    expect(unrolledHalfWidth(1, 1)).toBeCloseTo(EQUAL_EARTH_HALF_WIDTH, 4)
    expect(unrolledHalfHeight(1, 1)).toBeCloseTo(EQUAL_EARTH_HALF_HEIGHT, 4)
    expect(unrolledHalfWidth(0.4, 5)).toBeCloseTo(unrolledHalfWidth(0.4, 1) * 5, 6)
  })

  it('grows with at most a sub-1% wobble', () => {
    let prev = unrolledHalfHeight(0)
    for (let i = 1; i <= 20; i++) {
      expect(unrolledHalfHeight(i / 20)).toBeGreaterThanOrEqual(prev * 0.99)
      prev = unrolledHalfHeight(i / 20)
    }
  })
})

describe('unfoldedLiftedPosition', () => {
  const point = { lat: 12, lon: -140 }

  it('lifts radially on the sphere and along +z only on the map', () => {
    expect(Math.hypot(...unfoldedLiftedPosition(point, 0, 1, 0.02, 0.05))).toBeCloseTo(1.02, 6)
    const lifted = unfoldedLiftedPosition(point, 1, 1, 0.02, 0.05)
    const [mx, my] = lonLatToMap(point, 1)
    expect([...lifted]).toEqual([expect.closeTo(mx, 10), expect.closeTo(my, 10), expect.closeTo(1.05, 10)])
  })

  it('moves continuously and stays finite', () => {
    expectContinuous((u) => unfoldedLiftedPosition(point, u, 1, 0.02, 0.05), 200)
    for (const v of unfoldedLiftedPosition(point, 1 - 1e-9, 1, 0.02, 0.05)) expect(Number.isFinite(v)).toBe(true)
  })
})

describe('unfoldedNormal', () => {
  const point = { lat: 12, lon: -140 }

  it('is unit length, the sphere normal at 0 and +Z at 1, continuous between', () => {
    for (const unfold of [0, 0.25, 0.5, 0.9, 1]) expect(Math.hypot(...unfoldedNormal(point, unfold))).toBeCloseTo(1, 9)
    unfoldedNormal(point, 0).forEach((v, i) => expect(v).toBeCloseTo(lonLatToSphere(point)[i]!, 9))
    unfoldedNormal(point, 1).forEach((v, i) => expect(v).toBeCloseTo([0, 0, 1][i]!, 9))
    expectContinuous((u) => unfoldedNormal(point, u))
  })
})

describe('PROJECTION_GLSL', () => {
  it('pins every Equal Earth coefficient to its TS constant', () => {
    const glsl = (name: string) => Number(new RegExp(`const float ${name} = ([^;]+);`).exec(PROJECTION_GLSL)?.[1])
    expect(glsl('EE_A1')).toBe(EQUAL_EARTH_A1)
    expect(glsl('EE_A2')).toBe(EQUAL_EARTH_A2)
    expect(glsl('EE_A3')).toBe(EQUAL_EARTH_A3)
    expect(glsl('EE_A4')).toBe(EQUAL_EARTH_A4)
    expect(glsl('EE_M')).toBe(EQUAL_EARTH_M)
  })
})

describe('splitAtAntimeridian', () => {
  it('leaves non-crossing paths (including a 170° span) and trivial paths whole', () => {
    const path = [
      { lat: 0, lon: -85 },
      { lat: 0, lon: 85 },
    ]
    expect(splitAtAntimeridian(path)).toEqual([path])
    expect(splitAtAntimeridian([])).toEqual([])
    expect(splitAtAntimeridian([{ lat: 5, lon: 5 }])).toEqual([[{ lat: 5, lon: 5 }]])
  })

  it.each([
    [170, -170, 180, -180],
    [-170, 170, -180, 180],
  ])('splits %s → %s at the seam with a shared latitude', (from, to, endLon, startLon) => {
    const [first, second] = splitAtAntimeridian([
      { lat: 0, lon: from },
      { lat: 10, lon: to },
    ])
    expect(first!.at(-1)).toEqual({ lat: expect.closeTo(5), lon: endLon })
    expect(second![0]).toEqual({ lat: expect.closeTo(5), lon: startLon })
  })

  it('splits two crossings into three pieces', () => {
    expect(
      splitAtAntimeridian([
        { lat: 0, lon: 170 },
        { lat: 0, lon: -170 },
        { lat: 0, lon: -175 },
        { lat: 0, lon: 175 },
      ]),
    ).toHaveLength(3)
  })
})
