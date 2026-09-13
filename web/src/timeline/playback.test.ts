import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type Playback, type TimeScale } from '@/types/layer'

import { advancePlayhead } from './playback'
import { createSymlogScale } from './scale'

const fullScale: TimeScale = createSymlogScale([0, EARTH_FORMATION])

function playback(overrides: Partial<Playback> = {}): Playback {
  return { playing: true, baseRate: 0.1, speed: 1, ...overrides }
}

describe('advancePlayhead', () => {
  it('does not move t when not playing', () => {
    const t = 1e8
    expect(advancePlayhead(t, 1, playback({ playing: false }), fullScale)).toBe(t)
  })

  it('moves toward the present (t decreases)', () => {
    const t = 1e8
    const next = advancePlayhead(t, 1, playback(), fullScale)
    expect(next).toBeLessThan(t)
  })

  it('has constant du/dt: doubling dt doubles the warped-space displacement', () => {
    const t = 1e8
    const u0 = fullScale.toUnit(t)
    const du1 = fullScale.toUnit(advancePlayhead(t, 1, playback(), fullScale)) - u0
    const du2 = fullScale.toUnit(advancePlayhead(t, 2, playback(), fullScale)) - u0
    expect(du2).toBeCloseTo(du1 * 2, 9)
  })

  it('scales with speed: doubling speed doubles the warped-space displacement', () => {
    const t = 1e8
    const u0 = fullScale.toUnit(t)
    const du1 = fullScale.toUnit(advancePlayhead(t, 1, playback({ speed: 1 }), fullScale)) - u0
    const du2 = fullScale.toUnit(advancePlayhead(t, 1, playback({ speed: 2 }), fullScale)) - u0
    expect(du2).toBeCloseTo(du1 * 2, 9)
  })

  it('clamps at the present and never overshoots past t = 0', () => {
    const next = advancePlayhead(10, 1e9, playback({ speed: 64 }), fullScale)
    expect(next).toBe(0)
  })

  it('stays finite and clamped at extreme speed and dt (no NaN, no overshoot)', () => {
    const next = advancePlayhead(1e8, Number.MAX_VALUE, playback({ speed: 64 }), fullScale)
    expect(Number.isFinite(next)).toBe(true)
    expect(next).toBeGreaterThanOrEqual(0)
    expect(next).toBeLessThanOrEqual(EARTH_FORMATION)
  })

  it('is a no-op (not a crash) for a non-finite dt', () => {
    const t = 1e8
    expect(advancePlayhead(t, Number.NaN, playback(), fullScale)).toBe(t)
    expect(advancePlayhead(t, Infinity, playback(), fullScale)).toBe(t)
    expect(advancePlayhead(t, -Infinity, playback(), fullScale)).toBe(t)
  })

  it('never moves past t = 0 even already at the present', () => {
    expect(advancePlayhead(0, 1, playback(), fullScale)).toBe(0)
  })
})
