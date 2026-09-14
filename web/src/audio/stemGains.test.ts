import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { stemGains } from './stemGains'
import { STEM_IDS } from './stemIds'

const NO_FLOOD_BASALT: never[] = []

describe('stemGains (IMPLEMENTATION.md A6: checkpoints)', () => {
  it('wind is always > 0, ~0.6 at Earth formation and ~0.32 at present', () => {
    expect(stemGains(EARTH_FORMATION, NO_FLOOD_BASALT).wind).toBeCloseTo(0.6, 5)
    expect(stemGains(0, NO_FLOOD_BASALT).wind).toBeCloseTo(0.32, 5)
    // Mid-ramp: still clearly positive, never dips near/through zero.
    expect(stemGains(4.2e8, NO_FLOOD_BASALT).wind).toBeGreaterThan(0.3)
  })

  it.each([
    ['insects', 4.2e8, 3.5e8] as const,
    ['birds', 1.6e8, 1.2e8] as const,
    ['fire', 4.5e8, 3.85e8] as const,
    ['settlement', 1.2e4, 5000] as const,
    ['machinery', 1000, 100] as const,
  ])('%s is exactly 0 well before its ramp-in and non-zero well after', (id, before, after) => {
    expect(stemGains(before, NO_FLOOD_BASALT)[id]).toBe(0)
    expect(stemGains(after, NO_FLOOD_BASALT)[id]).toBeGreaterThan(0)
  })

  it('mammals has a small but non-zero pre-ramp baseline (0.04) rising to 0.32', () => {
    expect(stemGains(8.0e7, NO_FLOOD_BASALT).mammals).toBeCloseTo(0.04, 5)
    expect(stemGains(6.0e7, NO_FLOOD_BASALT).mammals).toBeCloseTo(0.32, 5)
    expect(stemGains(6.3e7, NO_FLOOD_BASALT).mammals).toBeGreaterThan(0.04)
    expect(stemGains(6.3e7, NO_FLOOD_BASALT).mammals).toBeLessThan(0.32)
  })

  it('volcanic spikes measurably higher at a flood-basalt window than nearby unaffected t', () => {
    // Siberian Traps (data/events.yaml t_min 2.5e8 / t_max 2.54e8) and Deccan Traps/K-Pg
    // (t_min 6.56e7 / t_max 6.63e7), passed the same way `engine.ts` derives them: flattened
    // from every flood-basalt-effect event's own windows.
    const windows = [
      { tMin: 2.5e8, tMax: 2.54e8 },
      { tMin: 6.56e7, tMax: 6.63e7 },
    ]
    const siberianMid = (2.5e8 + 2.54e8) / 2
    const deccanMid = (6.56e7 + 6.63e7) / 2
    const unaffectedNearby = 1.5e8 // between the two windows, far from either bump

    const atSiberian = stemGains(siberianMid, windows).volcanic
    const atDeccan = stemGains(deccanMid, windows).volcanic
    const baseline = stemGains(unaffectedNearby, windows).volcanic

    expect(atSiberian).toBeGreaterThan(baseline + 0.3)
    expect(atDeccan).toBeGreaterThan(baseline + 0.3)
  })

  it('volcanic without any flood-basalt windows still ramps from Hadean to present', () => {
    expect(stemGains(4.0e9, NO_FLOOD_BASALT).volcanic).toBeCloseTo(0.75, 5)
    expect(stemGains(0, NO_FLOOD_BASALT).volcanic).toBeCloseTo(0.15, 5)
  })

  it('storm is a flat placeholder baseline', () => {
    expect(stemGains(EARTH_FORMATION, NO_FLOOD_BASALT).storm).toBe(0.22)
    expect(stemGains(0, NO_FLOOD_BASALT).storm).toBe(0.22)
  })

  it('every stem stays within [0, 1] across a dense sweep of t, including near flood-basalt windows', () => {
    const windows = [
      { tMin: 2.5e8, tMax: 2.54e8 },
      { tMin: 6.56e7, tMax: 6.63e7 },
    ]
    const steps = 2000
    for (let i = 0; i <= steps; i++) {
      const t = (EARTH_FORMATION * i) / steps
      const gains = stemGains(t, windows)
      for (const id of STEM_IDS) {
        const value = gains[id]
        expect(value, `${id} at t=${t}`).toBeGreaterThanOrEqual(0)
        expect(value, `${id} at t=${t}`).toBeLessThanOrEqual(1)
      }
    }
  })

  it('is pure: identical t and windows content always produce the same result', () => {
    const windows = [{ tMin: 2.5e8, tMax: 2.54e8 }]
    expect(stemGains(1.2e8, windows)).toEqual(stemGains(1.2e8, [...windows]))
  })
})
