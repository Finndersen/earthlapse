import { describe, expect, it } from 'vitest'

import { isPoleVisible, poleDirection, POLE_VISIBILITY_MARGIN } from './poles'

describe('poleDirection', () => {
  it('puts north at +Y and south at -Y', () => {
    expect(poleDirection('N')).toEqual([0, 1, 0])
    expect(poleDirection('S')).toEqual([0, -1, 0])
  })
})

describe('isPoleVisible', () => {
  const RADIUS = 1

  it('shows the pole a camera sits directly above, hides the opposite one', () => {
    expect(isPoleVisible('N', [0, 5, 0], RADIUS)).toBe(true)
    expect(isPoleVisible('S', [0, 5, 0], RADIUS)).toBe(false)
  })

  it('shows the pole a camera sits directly below, hides the opposite one', () => {
    expect(isPoleVisible('S', [0, -5, 0], RADIUS)).toBe(true)
    expect(isPoleVisible('N', [0, -5, 0], RADIUS)).toBe(false)
  })

  it('hides both poles from a camera on the equatorial plane (side-on view, e.g. Globe.tsx\'s default camera)', () => {
    expect(isPoleVisible('N', [0, 0, 3.6], RADIUS)).toBe(false)
    expect(isPoleVisible('S', [0, 0, 3.6], RADIUS)).toBe(false)
  })

  it('is a pure function of camera *direction*, not distance: the same viewing angle keeps the same cos(θ) regardless of how far the camera sits', () => {
    // 30° off the north pole axis, at two different distances.
    const direction = [Math.sin(Math.PI / 6), Math.cos(Math.PI / 6), 0] as const
    const near: readonly [number, number, number] = [direction[0] * 1.1, direction[1] * 1.1, direction[2] * 1.1]
    const far: readonly [number, number, number] = [direction[0] * 20, direction[1] * 20, direction[2] * 20]
    // Close in, the horizon threshold (sphereRadius / distance) is steep enough to hide a point
    // 30° off-axis; far away it's shallow enough to show the same angle.
    expect(isPoleVisible('N', near, RADIUS)).toBe(false)
    expect(isPoleVisible('N', far, RADIUS)).toBe(true)
  })

  it('crosses from hidden to visible as the camera moves further back at a fixed angle, right where the margin predicts', () => {
    const direction = [Math.sin(Math.PI / 6), Math.cos(Math.PI / 6), 0] as const
    const cosAngle = Math.cos(Math.PI / 6)
    // threshold(d) = sphereRadius / d + margin; visible once cosAngle > threshold(d), i.e.
    // d > sphereRadius / (cosAngle - margin).
    const crossoverDistance = RADIUS / (cosAngle - POLE_VISIBILITY_MARGIN)
    const justBefore: readonly [number, number, number] = [
      direction[0] * (crossoverDistance - 0.05),
      direction[1] * (crossoverDistance - 0.05),
      direction[2] * (crossoverDistance - 0.05),
    ]
    const justAfter: readonly [number, number, number] = [
      direction[0] * (crossoverDistance + 0.05),
      direction[1] * (crossoverDistance + 0.05),
      direction[2] * (crossoverDistance + 0.05),
    ]
    expect(isPoleVisible('N', justBefore, RADIUS)).toBe(false)
    expect(isPoleVisible('N', justAfter, RADIUS)).toBe(true)
  })

  it('never shows a pole from the exact centre of the sphere (degenerate camera distance)', () => {
    expect(isPoleVisible('N', [0, 0, 0], RADIUS)).toBe(false)
    expect(isPoleVisible('S', [0, 0, 0], RADIUS)).toBe(false)
  })

  it('scales the horizon threshold with sphereRadius: a bigger sphere hides the pole from the same camera position that showed a smaller one', () => {
    // cos(θ) = 0.6 at |C| = 2: visible once radius/2 + margin < 0.6, i.e. radius < 1.14.
    const cameraPosition: readonly [number, number, number] = [1.6, 1.2, 0]
    expect(isPoleVisible('N', cameraPosition, 1)).toBe(true)
    expect(isPoleVisible('N', cameraPosition, 1.4)).toBe(false)
  })
})
