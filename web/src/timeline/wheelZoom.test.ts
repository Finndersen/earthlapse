import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import type { TimeWindow } from './scale'
import { smoothWindowStep, windowsNearlyEqual, WHEEL_ZOOM_SETTLE_EPSILON, WHEEL_ZOOM_SMOOTHING_MS } from './wheelZoom'

describe('smoothWindowStep (wheel-zoom accumulation, no jumpy steps)', () => {
  const current: TimeWindow = [1e6, 1e8]
  const target: TimeWindow = [2e6, 5e7]

  it('moves partway from current toward target for a positive dt', () => {
    const result = smoothWindowStep(current, target, 16, 'symlog')
    expect(result[0]).toBeGreaterThan(current[0])
    expect(result[0]).toBeLessThan(target[0])
    expect(result[1]).toBeLessThan(current[1])
    expect(result[1]).toBeGreaterThan(target[1])
  })

  it('moves further in one large step than in one small step (monotone in dt)', () => {
    const small = smoothWindowStep(current, target, 4, 'symlog')
    const large = smoothWindowStep(current, target, 40, 'symlog')
    // Distance remaining to the target should shrink faster for the larger step.
    expect(Math.abs(large[0] - target[0])).toBeLessThan(Math.abs(small[0] - target[0]))
  })

  it('approaches but never overshoots the target', () => {
    const result = smoothWindowStep(current, target, 1000, 'symlog')
    expect(result[0]).toBeGreaterThan(current[0])
    expect(result[0]).toBeLessThanOrEqual(target[0] + 1e-6)
  })

  it('snaps straight to target for a non-positive dt (first frame, no previous timestamp)', () => {
    expect(smoothWindowStep(current, target, 0, 'symlog')).toEqual(target)
    expect(smoothWindowStep(current, target, -5, 'symlog')).toEqual(target)
  })

  it('snaps straight to target for a non-positive smoothingMs', () => {
    expect(smoothWindowStep(current, target, 16, 'symlog', 0)).toEqual(target)
  })

  it('is exactly current at dt=0... already covered; is (numerically) close to target for a huge dt', () => {
    const result = smoothWindowStep(current, target, 1e6, 'symlog', WHEEL_ZOOM_SMOOTHING_MS)
    expect(result[0]).toBeCloseTo(target[0], 0)
    expect(result[1]).toBeCloseTo(target[1], -3)
  })

  it('returns target unchanged (to floating-point precision) when current already equals target', () => {
    const result = smoothWindowStep(target, target, 16, 'symlog')
    expect(result[0]).toBeCloseTo(target[0], 6)
    expect(result[1]).toBeCloseTo(target[1], 6)
  })
})

describe('windowsNearlyEqual', () => {
  it('is true for identical windows', () => {
    const w: TimeWindow = [1e6, 1e8]
    expect(windowsNearlyEqual(w, w, 'symlog')).toBe(true)
  })

  it('is true for windows within WHEEL_ZOOM_SETTLE_EPSILON in warped space', () => {
    const a: TimeWindow = [1e6, 1e8]
    // Perturb by repeatedly stepping toward a very close target — the resulting difference in
    // warped space should be far below the epsilon after enough steps.
    let current = a
    const target: TimeWindow = [1e6 + 1, 1e8 + 1]
    for (let i = 0; i < 50; i++) current = smoothWindowStep(current, target, 50, 'symlog')
    expect(windowsNearlyEqual(current, target, 'symlog')).toBe(true)
  })

  it('is false for windows far apart in warped space', () => {
    expect(windowsNearlyEqual([1e6, 1e8], [1e6, 4e9], 'symlog')).toBe(false)
  })

  it('respects a custom epsilon', () => {
    const a: TimeWindow = [0, EARTH_FORMATION]
    const b: TimeWindow = [0, EARTH_FORMATION]
    expect(windowsNearlyEqual(a, b, 'symlog', WHEEL_ZOOM_SETTLE_EPSILON)).toBe(true)
  })
})
