import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { FOLLOW_TARGET_U, FOLLOW_TRIGGER_U, followWindow } from './follow'
import { createLinearScale, createSymlogScale, type TimeWindow } from './scale'

describe('followWindow', () => {
  it('leaves the window unchanged when the playhead is below the trigger threshold', () => {
    const window: TimeWindow = [1000, 2000]
    // u = (2000 - 1500) / 1000 = 0.5, well under FOLLOW_TRIGGER_U.
    const result = followWindow(window, 1500, 'linear')
    expect(result).toEqual(window)
  })

  it('leaves the window unchanged exactly at the trigger boundary (strict inequality)', () => {
    const window: TimeWindow = [1000, 2000]
    const scale = createLinearScale(window)
    const tAtTrigger = scale.fromUnit(FOLLOW_TRIGGER_U)
    expect(followWindow(window, tAtTrigger, 'linear')).toEqual(window)
  })

  it('pans (without resizing) so the playhead sits back at FOLLOW_TARGET_U once triggered (linear)', () => {
    const window: TimeWindow = [1000, 2000]
    const span = window[1] - window[0]
    const t = 1100 // u = (2000 - 1100) / 1000 = 0.9 > 0.85
    const result = followWindow(window, t, 'linear')
    expect(result).not.toEqual(window)
    expect(result[1] - result[0]).toBeCloseTo(span, 6)
    const resultScale = createLinearScale(result)
    expect(resultScale.toUnit(t)).toBeCloseTo(FOLLOW_TARGET_U, 4)
  })

  it('pans so the playhead sits back at FOLLOW_TARGET_U once triggered (symlog)', () => {
    // Window sits comfortably inside the domain (far from both t=0 and EARTH_FORMATION) so the
    // pan needed to reach FOLLOW_TARGET_U is actually achievable without clamping — a window
    // this close to the present edge (e.g. [1e6, 1e8]) can't shift far enough before its
    // newest bound hits 0, and the trigger/target math is covered separately by the
    // near-present clamping tests below.
    const window: TimeWindow = [2e8, 2.1e8]
    const span = window[1] - window[0]
    const scale = createSymlogScale(window)
    const t = scale.fromUnit(0.92) // above the trigger
    const result = followWindow(window, t, 'symlog')
    expect(result[1] - result[0]).toBeCloseTo(span, 0)
    const resultScale = createSymlogScale(result)
    expect(resultScale.toUnit(t)).toBeCloseTo(FOLLOW_TARGET_U, 3)
  })

  it('keeps the span exactly constant even when the pan is clamped at the present', () => {
    const window: TimeWindow = [0, 1000]
    const t = 100 // u = (1000 - 100) / 1000 = 0.9, but newest is already 0 — nowhere to pan
    const result = followWindow(window, t, 'linear')
    expect(result[0]).toBe(0)
    expect(result[1] - result[0]).toBeCloseTo(1000, 6)
  })

  it('clamps by sliding rather than shrinking the span near the present edge', () => {
    const window: TimeWindow = [200, 1200]
    const span = window[1] - window[0]
    const t = 250 // triggers, but the unclamped target pan would push newest below 0
    const result = followWindow(window, t, 'linear')
    expect(result[0]).toBeGreaterThanOrEqual(0)
    expect(result[1] - result[0]).toBeCloseTo(span, 6)
  })

  it('never produces a window outside [0, EARTH_FORMATION]', () => {
    const window: TimeWindow = [100, 5000]
    const result = followWindow(window, 4900, 'linear')
    expect(result[0]).toBeGreaterThanOrEqual(0)
    expect(result[1]).toBeLessThanOrEqual(EARTH_FORMATION)
  })

  it('is pure: identical inputs produce identical output', () => {
    const window: TimeWindow = [1e6, 1e8]
    const a = followWindow(window, 9e7, 'symlog')
    const b = followWindow(window, 9e7, 'symlog')
    expect(a).toEqual(b)
  })

  it('rejects density, which is out of scope for this package', () => {
    expect(() => followWindow([0, EARTH_FORMATION], 0, 'density')).toThrow(/density/)
  })
})
