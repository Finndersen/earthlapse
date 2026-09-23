import { describe, expect, it } from 'vitest'

import type { Playback } from '@/types/layer'

import { defaultSteadyRate, SCENES_SPEEDS, STEADY_RATES, stepActiveRate, stepDetent } from './playbackRates'
import { ROOT_SECTION_ID, sectionById } from './sections'

describe('playback rate detents', () => {
  it('steps one detent, clamping at both ends and resolving an off-table value to the requested side', () => {
    expect(stepDetent(STEADY_RATES, 5, 'up')).toBe(10)
    expect(stepDetent(SCENES_SPEEDS, 1, 'down')).toBe(0.5)
    expect(stepDetent(SCENES_SPEEDS, 64, 'up')).toBe(64)
    expect(stepDetent(STEADY_RATES, 1, 'down')).toBe(1)
    expect(stepDetent(STEADY_RATES, 30, 'up')).toBe(50)
    expect(stepDetent(STEADY_RATES, 30, 'down')).toBe(20)
  })

  it("steps only the active mode's rate", () => {
    const pb: Playback = { playing: false, baseRate: 0.02, speed: 1, yearsPerSecond: 10, mode: 'scenes' }
    expect(stepActiveRate(pb, 'up')).toEqual({ ...pb, speed: 2 })
    expect(stepActiveRate({ ...pb, mode: 'steady' }, 'down')).toEqual({ ...pb, mode: 'steady', yearsPerSecond: 5 })
  })

  it('defaults steady mode to a detent sized to the section span, capped by the distance to the present', () => {
    const root = sectionById(ROOT_SECTION_ID).window
    expect(defaultSteadyRate(root, 100)).toBe(1)
    let previous = Infinity
    for (const t of [4.5e9, 1e9, 1e7, 1e5, 1e3, 10]) {
      const rate = defaultSteadyRate(root, t)
      expect(STEADY_RATES).toContain(rate)
      expect(rate).toBeLessThanOrEqual(previous)
      previous = rate
    }
    const cretaceous = sectionById('cretaceous').window
    expect(defaultSteadyRate(cretaceous, cretaceous[1])).toBeLessThan(defaultSteadyRate(root, 4.5e9))
  })
})
