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
  PROJECTION_GLSL,
  splitAtAntimeridian,
  unfoldedLiftedPosition,
  unfoldedPosition,
  unrolledHalfHeight,
  unrolledHalfWidth,
} from './projection'

describe('lonLatToSphere', () => {
  it('puts the poles on +-Y, matching poles.ts', () => {
    const [nx, ny, nz] = lonLatToSphere({ lat: 90, lon: 0 })
    expect(nx).toBeCloseTo(0)
    expect(ny).toBeCloseTo(1)
    expect(nz).toBeCloseTo(0)
    const [, sy] = lonLatToSphere({ lat: -90, lon: 0 })
    expect(sy).toBeCloseTo(-1)
  })

  it('recovers latitude via asin(y), and longitude via atan2(x,z) (this module’s own doc comment on why lon 0 faces +Z)', () => {
    for (const point of [{ lat: 0, lon: 0 }, { lat: 21.3, lon: -89.5 }, { lat: -45, lon: 170 }]) {
      const [x, y, z] = lonLatToSphere(point)
      const lon = (Math.atan2(x, z) * 180) / Math.PI
      const lat = (Math.asin(y) * 180) / Math.PI
      expect(lon).toBeCloseTo(point.lon, 6)
      expect(lat).toBeCloseTo(point.lat, 6)
    }
  })

  it('agrees with effects/overlays.ts\'s own anchorUv (u = 0.5 + lon/360, v = 0.5 - lat/180) — both bypass lonLatToSphere/atan2 for uv, the same shortcut GLOBE_VERTEX_SHADER’s own uv varying takes', () => {
    const point = { lat: 21.3, lon: -89.5 }
    const uv = anchorUv(point)
    expect(uv.u).toBeCloseTo(0.5 + point.lon / 360, 6)
    expect(uv.v).toBeCloseTo(0.5 - point.lat / 180, 6)
  })

  it('scales by radius', () => {
    const [x, y, z] = lonLatToSphere({ lat: 0, lon: 0 }, 2.5)
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
    expect(z).toBeCloseTo(2.5)
  })
})

describe('lonLatToMap', () => {
  it('is centred on 0deg longitude', () => {
    const [x, y] = lonLatToMap({ lat: 0, lon: 0 })
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(0)
  })

  it('is symmetric about the central meridian and the equator', () => {
    const [xEast] = lonLatToMap({ lat: 30, lon: 90 })
    const [xWest] = lonLatToMap({ lat: 30, lon: -90 })
    expect(xEast).toBeCloseTo(-xWest)
    const [, yNorth] = lonLatToMap({ lat: 40, lon: 20 })
    const [, ySouth] = lonLatToMap({ lat: -40, lon: 20 })
    expect(yNorth).toBeCloseTo(-ySouth)
  })

  it('always draws z = 0 (a flat map)', () => {
    const [, , z] = lonLatToMap({ lat: -12, lon: 140 })
    expect(z).toBe(0)
  })

  it('matches the published Equal Earth bounding box at radius 1 (~2.707 x ~1.317)', () => {
    expect(EQUAL_EARTH_HALF_WIDTH).toBeCloseTo(2.707, 2)
    expect(EQUAL_EARTH_HALF_HEIGHT).toBeCloseTo(1.317, 2)
  })

  it('flattens the poles to a line narrower than the equator (Equal Earth\'s curved-meridian look)', () => {
    const [xPole] = lonLatToMap({ lat: 90, lon: 180 })
    expect(Math.abs(xPole)).toBeLessThan(EQUAL_EARTH_HALF_WIDTH)
  })

  // Orientation sanity: pins east/north as positive x/y so the map can never
  // silently mirror east-west or flip north-south — the failure mode would be subtle (every
  // internal consistency check above still passes under a mirrored convention, since symmetry
  // and bounding-box tests don't care which side is "east") and only obvious by eye (the
  // Americas on the wrong side of the map). `+90` and `+60` are arbitrary but unambiguous:
  // comfortably inside the domain, away from the equator/central-meridian zero-crossings a sign
  // bug could otherwise hide behind.
  it('places positive longitude (east) at positive x', () => {
    const [x] = lonLatToMap({ lat: 0, lon: 90 })
    expect(x).toBeGreaterThan(0)
  })

  it('places positive latitude (north) at positive y', () => {
    const [, y] = lonLatToMap({ lat: 60, lon: 0 })
    expect(y).toBeGreaterThan(0)
  })

  it('orders the Americas west of Africa and Africa west of Asia, left to right', () => {
    // Representative longitudes, not precise coastlines: -80 (roughly the Americas), 20 (roughly
    // Africa/Europe), 100 (roughly East/South Asia) — the ordering is what matters here.
    const [xAmericas] = lonLatToMap({ lat: 10, lon: -80 })
    const [xAfrica] = lonLatToMap({ lat: 10, lon: 20 })
    const [xAsia] = lonLatToMap({ lat: 10, lon: 100 })
    expect(xAmericas).toBeLessThan(xAfrica)
    expect(xAfrica).toBeLessThan(xAsia)
  })
})

describe('lonLatToSphere orientation', () => {
  it('places lon 0 on +Z — the sphere\'s own default-facing point (Globe.tsx\'s camera sits on +Z) matches lonLatToMap\'s own map centre', () => {
    const [x, , z] = lonLatToSphere({ lat: 0, lon: 0 })
    expect(x).toBeCloseTo(0)
    expect(z).toBeGreaterThan(0)
  })

  it('places positive longitude (east) on the +X side, matching lonLatToMap\'s own east-is-positive-x convention', () => {
    // Not itself a screen-space claim (the sphere rotates) — this pins the same
    // atan2(x, z) = lon relationship the "recovers lat/lon" test above already exercises,
    // stated as a plain sign check for a quick eyeball reference alongside lonLatToMap's own.
    const [x] = lonLatToSphere({ lat: 0, lon: 90 })
    expect(x).toBeGreaterThan(0)
  })

  it('places positive latitude (north) at positive y', () => {
    const [, y] = lonLatToSphere({ lat: 60, lon: 0 })
    expect(y).toBeGreaterThan(0)
  })

  // The winding/chirality bug this pins (globeGeometry.test.ts's "faces every triangle outward")
  // manifested visually as a mirrored globe: with the camera facing a given longitude, everything
  // east of it rendered on the *left* instead of the right. This test reproduces that check in
  // pure math — a standard right-handed look-at camera basis, no three.js — so a regression here
  // fails a fast unit test rather than only a screenshot.
  function lookAtRightAxis(eye: readonly [number, number, number], target: readonly [number, number, number], up: readonly [number, number, number]) {
    const sub = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!]
    const cross = (a: readonly number[], b: readonly number[]): [number, number, number] => [
      a[1]! * b[2]! - a[2]! * b[1]!,
      a[2]! * b[0]! - a[0]! * b[2]!,
      a[0]! * b[1]! - a[1]! * b[0]!,
    ]
    const norm = (a: readonly number[]): [number, number, number] => {
      const len = Math.hypot(...a)
      return [a[0]! / len, a[1]! / len, a[2]! / len]
    }
    // Standard right-handed look-at basis (matches three.js's own camera convention: looks down
    // its local -Z, +X is screen-right).
    const backward = norm(sub(eye, target))
    return norm(cross(up, backward))
  }

  it('renders a point east of the camera\'s facing longitude to the viewer\'s right (India, 78°E, right of Africa, 20°E, when facing 50°E)', () => {
    const cameraDistance = 3.6
    const facingLon = 50
    const eye = lonLatToSphere({ lat: 0, lon: facingLon }, cameraDistance)
    const target: [number, number, number] = [0, 0, 0]
    const up: [number, number, number] = [0, 1, 0]
    const rightAxis = lookAtRightAxis(eye, target, up)

    const dotRight = (p: readonly [number, number, number]) => p[0] * rightAxis[0] + p[1] * rightAxis[1] + p[2] * rightAxis[2]
    const africaScreenX = dotRight(lonLatToSphere({ lat: 0, lon: 20 }))
    const indiaScreenX = dotRight(lonLatToSphere({ lat: 20, lon: 78 }))
    expect(indiaScreenX).toBeGreaterThan(africaScreenX)
  })
})

describe('unfoldedPosition (curvature unroll — ADR-033 amendment)', () => {
  const point = { lat: 12, lon: -140 }

  it('is exactly the sphere position at unfold = 0', () => {
    const [x, y, z] = unfoldedPosition(point, 0)
    const [sx, sy, sz] = lonLatToSphere(point)
    expect(x).toBeCloseTo(sx, 10)
    expect(y).toBeCloseTo(sy, 10)
    expect(z).toBeCloseTo(sz, 10)
  })

  it('is exactly the map position at unfold = 1, offset to z = radius (not z = 0 — this module\'s own doc comment on why)', () => {
    const [x, y, z] = unfoldedPosition(point, 1, 2)
    const [mx, my] = lonLatToMap(point, 2)
    expect(x).toBeCloseTo(mx, 10)
    expect(y).toBeCloseTo(my, 10)
    expect(z).toBeCloseTo(2, 10)
  })

  it('clamps unfold to [0, 1]', () => {
    expect(unfoldedPosition(point, -1)).toEqual(unfoldedPosition(point, 0))
    expect(unfoldedPosition(point, 2)).toEqual(unfoldedPosition(point, 1))
  })

  it('keeps the centre point (lon 0, lat 0) exactly fixed at (0, 0, radius) for every unfold', () => {
    const centre = { lat: 0, lon: 0 }
    for (const unfold of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.999, 1]) {
      const [x, y, z] = unfoldedPosition(centre, unfold, 3)
      expect(x).toBeCloseTo(0, 9)
      expect(y).toBeCloseTo(0, 9)
      expect(z).toBeCloseTo(3, 9)
    }
  })

  it('is continuous across the whole unfold range — no jump between adjacent samples', () => {
    const steps = 400
    let prev = unfoldedPosition(point, 0)
    for (let i = 1; i <= steps; i++) {
      const unfold = i / steps
      const curr = unfoldedPosition(point, unfold)
      const jump = Math.hypot(curr[0] - prev[0], curr[1] - prev[1], curr[2] - prev[2])
      expect(jump).toBeLessThan(0.05)
      prev = curr
    }
  })

  it('never produces NaN or Infinity near k = 0 (unfold near 1)', () => {
    for (const unfold of [0.999, 0.9999, 0.99999, 1 - 1e-9, 1]) {
      const [x, y, z] = unfoldedPosition(point, unfold)
      for (const v of [x, y, z]) {
        expect(Number.isFinite(v)).toBe(true)
      }
    }
  })

  it('does not pass through a flat quadrilateral silhouette mid-unfold (the regression this fixes) — equatorial points stay spread across a range at unfold = 0.5, not collapsed near a few discrete corners', () => {
    // A plain per-axis xyz lerp visibly faceted into a hexagon/octagon (scratchpad/transition-*
    // contact sheets). The curvature unroll keeps every equatorial point's radius from the
    // sphere's own axis smoothly varying with longitude at any mid-unfold value, rather than
    // "on a face" (~constant) or "on an edge" (a sharp transition) the way a lerped polyhedron
    // would. Sampled radii should therefore be strictly increasing as |lon| grows from 0 to 180
    // at the midpoint — never flat, never non-monotonic.
    const unfold = 0.5
    const radii = [0, 30, 60, 90, 120, 150, 179].map((lon) => {
      const [x, , z] = unfoldedPosition({ lat: 0, lon }, unfold)
      return Math.hypot(x, z)
    })
    for (let i = 1; i < radii.length; i++) {
      expect(radii[i]).toBeGreaterThan(radii[i - 1]!)
    }
  })
})

describe('unrolledHalfWidth / unrolledHalfHeight', () => {
  it('is exactly GLOBE_RADIUS (the sphere\'s own silhouette) at unfold = 0', () => {
    expect(unrolledHalfWidth(0, 2)).toBeCloseTo(2, 6)
    expect(unrolledHalfHeight(0, 2)).toBeCloseTo(2, 6)
  })

  it('is exactly the Equal Earth half-extents at unfold = 1', () => {
    expect(unrolledHalfWidth(1, 1)).toBeCloseTo(EQUAL_EARTH_HALF_WIDTH, 4)
    expect(unrolledHalfHeight(1, 1)).toBeCloseTo(EQUAL_EARTH_HALF_HEIGHT, 4)
  })

  it('grows from sphere to map with at most a sub-1%-relative wobble near the flat endpoint', () => {
    // Not exactly monotonic: `unfoldedPosition`'s equirectangular-to-Equal-Earth coordinate blend
    // and its curvature `k = 1 - unfold` ease at the same, plain linear rate, and the pole's own
    // `sin(Yk)/k` isn't quite monotonic in `unfold` across that particular combination — a real,
    // if tiny (well under 1% of the ~1.32-unit half-height), dip in the last few percent of the
    // unroll. `EQUAL_EARTH_HALF_HEIGHT`'s own tolerance above still pins the true endpoint value;
    // this loose a bound is enough to catch a *real* regression (a lerp-sized jump) without
    // failing on this known, sub-visual wobble.
    let prev = unrolledHalfHeight(0)
    for (let i = 1; i <= 20; i++) {
      const curr = unrolledHalfHeight(i / 20)
      expect(curr).toBeGreaterThanOrEqual(prev * 0.99)
      prev = curr
    }
  })

  it('scales linearly with radius', () => {
    expect(unrolledHalfWidth(0.4, 5)).toBeCloseTo(unrolledHalfWidth(0.4, 1) * 5, 6)
    expect(unrolledHalfHeight(0.4, 5)).toBeCloseTo(unrolledHalfHeight(0.4, 1) * 5, 6)
  })
})

describe('unfoldedLiftedPosition (curvature unroll)', () => {
  const point = { lat: 12, lon: -140 }

  it('lifts the sphere position radially (a fraction of radius further out than the plain sphere point)', () => {
    const lifted = unfoldedLiftedPosition(point, 0, 1, 0.02, 0.05)
    const plain = lonLatToSphere(point, 1)
    const liftedLen = Math.hypot(...lifted)
    const plainLen = Math.hypot(...plain)
    expect(liftedLen).toBeCloseTo(1.02, 6)
    expect(liftedLen).toBeGreaterThan(plainLen)
  })

  it('offsets the flat map position by +z only, leaving x/y exactly equal to the plain map position (no radius inflation) — z includes the curvature unroll\'s own radius offset', () => {
    const lifted = unfoldedLiftedPosition(point, 1, 1, 0.02, 0.05)
    const plain = lonLatToMap(point, 1)
    expect(lifted[0]).toBeCloseTo(plain[0], 10)
    expect(lifted[1]).toBeCloseTo(plain[1], 10)
    expect(lifted[2]).toBeCloseTo(1 + 0.05, 10)
  })

  it('is continuous between the two endpoints — no jump between adjacent samples', () => {
    const steps = 200
    let prev = unfoldedLiftedPosition(point, 0, 1, 0.02, 0.05)
    for (let i = 1; i <= steps; i++) {
      const unfold = i / steps
      const curr = unfoldedLiftedPosition(point, unfold, 1, 0.02, 0.05)
      const jump = Math.hypot(curr[0] - prev[0], curr[1] - prev[1], curr[2] - prev[2])
      expect(jump).toBeLessThan(0.05)
      prev = curr
    }
  })

  it('never produces NaN near k = 0', () => {
    for (const unfold of [0.999, 0.9999, 1 - 1e-9, 1]) {
      const lifted = unfoldedLiftedPosition(point, unfold, 1, 0.02, 0.05)
      for (const v of lifted) expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('PROJECTION_GLSL', () => {
  // Regression net against a hand-edited GLSL literal drifting from the TS constant it should
  // be interpolated from (the interpolation itself is what actually prevents drift — see the
  // module doc comment) — extracts each `const float EE_* = <value>;` and compares it to the TS
  // export by the same name.
  function glslConstant(name: string): number {
    const match = new RegExp(`const float ${name} = ([^;]+);`).exec(PROJECTION_GLSL)
    if (match === null) throw new Error(`PROJECTION_GLSL has no ${name} constant`)
    return Number(match[1])
  }

  it('pins every Equal Earth coefficient to its TS constant', () => {
    expect(glslConstant('EE_A1')).toBe(EQUAL_EARTH_A1)
    expect(glslConstant('EE_A2')).toBe(EQUAL_EARTH_A2)
    expect(glslConstant('EE_A3')).toBe(EQUAL_EARTH_A3)
    expect(glslConstant('EE_A4')).toBe(EQUAL_EARTH_A4)
    expect(glslConstant('EE_M')).toBe(EQUAL_EARTH_M)
  })

  it('exports lonLatToSphere, lonLatToMap, unfoldedPosition and unfoldedLiftedPosition', () => {
    expect(PROJECTION_GLSL).toContain('vec3 lonLatToSphere(vec2 lonLatDeg)')
    expect(PROJECTION_GLSL).toContain('vec3 lonLatToMap(vec2 lonLatDeg)')
    expect(PROJECTION_GLSL).toContain('vec3 unfoldedPosition(vec2 lonLatDeg, float unfold)')
    expect(PROJECTION_GLSL).toContain('vec3 unfoldedLiftedPosition(vec2 lonLatDeg, float unfold, float sphereLift, float mapZOffset)')
  })
})

describe('splitAtAntimeridian', () => {
  it('returns a single segment for a path that never crosses the seam', () => {
    const points = [{ lat: 0, lon: -20 }, { lat: 10, lon: 0 }, { lat: 20, lon: 30 }]
    expect(splitAtAntimeridian(points)).toEqual([points])
  })

  it('handles 0 and 1 points without splitting', () => {
    expect(splitAtAntimeridian([])).toEqual([])
    expect(splitAtAntimeridian([{ lat: 5, lon: 5 }])).toEqual([[{ lat: 5, lon: 5 }]])
  })

  it('splits an eastbound crossing (170deg -> -170deg) into two pieces meeting at the seam', () => {
    const segments = splitAtAntimeridian([{ lat: 0, lon: 170 }, { lat: 10, lon: -170 }])
    expect(segments).toHaveLength(2)
    const [first, second] = segments as [typeof segments[0], typeof segments[0]]
    expect(first).toHaveLength(2)
    expect(second).toHaveLength(2)
    expect(first[1]!.lon).toBe(180)
    expect(second[0]!.lon).toBe(-180)
    // The interpolated seam latitude must agree on both sides of the split.
    expect(first[1]!.lat).toBeCloseTo(5)
    expect(second[0]!.lat).toBeCloseTo(5)
  })

  it('splits a westbound crossing (-170deg -> 170deg) symmetrically', () => {
    const segments = splitAtAntimeridian([{ lat: 0, lon: -170 }, { lat: 20, lon: 170 }])
    expect(segments).toHaveLength(2)
    const [first, second] = segments as [typeof segments[0], typeof segments[0]]
    expect(first[1]!.lon).toBe(-180)
    expect(second[0]!.lon).toBe(180)
    expect(first[1]!.lat).toBeCloseTo(10)
    expect(second[0]!.lat).toBeCloseTo(10)
  })

  it('splits a path with two separate crossings into three pieces', () => {
    const segments = splitAtAntimeridian([
      { lat: 0, lon: 170 },
      { lat: 0, lon: -170 }, // crossing 1
      { lat: 0, lon: -175 },
      { lat: 0, lon: 175 }, // crossing 2
    ])
    expect(segments).toHaveLength(3)
  })

  it('does not split a long great-circle-ish path that stays within 180deg of longitude change', () => {
    // 170deg of travel, not > 180deg, so this is not treated as a seam crossing.
    const points = [{ lat: 0, lon: -85 }, { lat: 0, lon: 85 }]
    expect(splitAtAntimeridian(points)).toEqual([points])
  })
})
