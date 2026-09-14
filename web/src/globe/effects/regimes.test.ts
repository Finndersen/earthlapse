import { describe, expect, it } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import { REGIME_EVENTS } from './fixtures'
import { symlogWarp, SYMLOG_C } from './math'
import { dominantRegime, regimeWeightsAt } from './regimes'

describe('regimeWeightsAt', () => {
  it('is all zero with no regime events', () => {
    expect(regimeWeightsAt([], 4.4e9)).toEqual({ magmaOcean: 0, waterWorld: 0, archean: 0, unknownGeography: 0 })
  })

  it('is all zero deep inside the PaleoDEM domain, well after every regime', () => {
    const weights = regimeWeightsAt(REGIME_EVENTS, 1e8)
    expect(weights).toEqual({ magmaOcean: 0, waterWorld: 0, archean: 0, unknownGeography: 0 })
  })

  it('is pure in t — the same input twice gives the same result', () => {
    const a = regimeWeightsAt(REGIME_EVENTS, 3.1e9)
    const b = regimeWeightsAt(REGIME_EVENTS, 3.1e9)
    expect(a).toEqual(b)
  })

  it('gives each regime full weight deep in its own interior, away from every edge', () => {
    // magma-ocean-regime [4.35e9, 4.52e9]: deep interior, away from its standalone tMax edge
    // and the tMin overlap with water-world.
    expect(regimeWeightsAt(REGIME_EVENTS, 4.45e9).magmaOcean).toBeCloseTo(1, 5)
    // archean-haze-regime [2.4e9, 4.0e9]: its interior is huge (1.6 Gyr), so its midpoint is
    // far from both its touching boundaries.
    expect(regimeWeightsAt(REGIME_EVENTS, 3.2e9).archean).toBeCloseTo(1, 5)
    // unknown-geography [1.0e9, 2.4e9]: interior, away from its archean-touching tMax edge and
    // its own standalone tMin edge.
    expect(regimeWeightsAt(REGIME_EVENTS, 1.7e9).unknownGeography).toBeCloseTo(1, 5)
  })

  it('crossfades magma-ocean into water-world across their cited 50 Myr overlap, summing near 1', () => {
    // magma-ocean [4.35e9, 4.52e9], water-world [4.0e9, 4.4e9]: overlap is [4.35e9, 4.4e9].
    const atOlderEdge = regimeWeightsAt(REGIME_EVENTS, 4.4e9) // fully magma's side of the overlap
    expect(atOlderEdge.magmaOcean).toBeCloseTo(1, 2)
    expect(atOlderEdge.waterWorld).toBeCloseTo(0, 2)

    const atYoungerEdge = regimeWeightsAt(REGIME_EVENTS, 4.35e9) // fully water's side
    expect(atYoungerEdge.magmaOcean).toBeCloseTo(0, 2)
    expect(atYoungerEdge.waterWorld).toBeCloseTo(1, 2)

    const atMidpoint = regimeWeightsAt(REGIME_EVENTS, 4.375e9)
    expect(atMidpoint.magmaOcean).toBeGreaterThan(0)
    expect(atMidpoint.waterWorld).toBeGreaterThan(0)
    expect(atMidpoint.magmaOcean + atMidpoint.waterWorld).toBeCloseTo(1, 1)
  })

  it('softens a boundary even where the cited dates only touch, with no gap to zero', () => {
    // hadean-water-world-regime tMin (4.0e9) touches archean-haze-regime tMax (4.0e9) exactly.
    const t = 4.0e9
    const at = regimeWeightsAt(REGIME_EVENTS, t)
    // Neither is fully in charge right at the touch point...
    expect(at.waterWorld).toBeGreaterThan(0)
    expect(at.archean).toBeGreaterThan(0)
    // ...and nearby samples never dip to "no regime at all" (the naive independent-trapezoid
    // failure mode this crossfade is designed to avoid).
    for (const nearby of [t - 1.5e7, t - 5e6, t, t + 5e6, t + 1.5e7]) {
      const weights = regimeWeightsAt(REGIME_EVENTS, nearby)
      expect(weights.waterWorld + weights.archean).toBeGreaterThan(0.1)
    }
  })

  it('never lets two regimes sum to visibly more than 1', () => {
    for (let t = 9e8; t <= 4.6e9; t += 1e7) {
      const w = regimeWeightsAt(REGIME_EVENTS, t)
      const sum = w.magmaOcean + w.waterWorld + w.archean + w.unknownGeography
      expect(sum).toBeLessThanOrEqual(1.01)
    }
  })

  it('fades the oldest regime to nothing beyond its own open (standalone) edge', () => {
    const wellBefore = regimeWeightsAt(REGIME_EVENTS, 4.6e9)
    expect(wellBefore.magmaOcean).toBe(0)
    const atEdge = regimeWeightsAt(REGIME_EVENTS, 4.52e9)
    const justInside = regimeWeightsAt(REGIME_EVENTS, 4.5e9)
    expect(atEdge.magmaOcean).toBeLessThan(justInside.magmaOcean)
  })

  it('fades the youngest regime to nothing beyond its own open (standalone) edge', () => {
    const wellAfter = regimeWeightsAt(REGIME_EVENTS, 8e8)
    expect(wellAfter.unknownGeography).toBe(0)
    const atEdge = regimeWeightsAt(REGIME_EVENTS, 1.0e9)
    const justInside = regimeWeightsAt(REGIME_EVENTS, 1.05e9)
    expect(atEdge.unknownGeography).toBeLessThan(justInside.unknownGeography)
  })

  it('ignores non-regime effect kinds (e.g. ice-shell) when computing regime weights', () => {
    // paleoproterozoic-glaciation-regime (ice-shell) sits inside archean-haze-regime's own
    // span — it must not create a fifth "regime" or perturb archean's weight.
    const weights = regimeWeightsAt(REGIME_EVENTS, 2.44e9)
    expect(weights.archean).toBeCloseTo(1, 5)
  })
})

describe('dominantRegime', () => {
  it('is null when every weight is zero', () => {
    expect(dominantRegime({ magmaOcean: 0, waterWorld: 0, archean: 0, unknownGeography: 0 })).toBeNull()
  })

  it('picks the largest weight', () => {
    expect(dominantRegime({ magmaOcean: 0.2, waterWorld: 0.8, archean: 0, unknownGeography: 0 })).toEqual({
      kind: 'regime-water-world',
      weight: 0.8,
    })
  })
})

describe('regime edge easing across eras', () => {
  const unwarp = (w: number): number => SYMLOG_C * Math.expm1(w)
  const standalone = (tMin: number, tMax: number): TimelineEvent => ({
    id: 'standalone-regime',
    label: 'Standalone regime',
    tMin,
    tMax,
    importance: 0.5,
    description: 'placeholder',
    citation: 'placeholder',
    effect: { kind: 'regime-unknown-geography', windows: [{ tMin, tMax }] },
  })
  /** Weight a small, fixed warped distance inside a standalone regime's younger (`tMin`) edge. */
  const justInsideYoungerEdge = (tMin: number): number =>
    regimeWeightsAt([standalone(tMin, tMin * 3)], unwarp(symlogWarp(tMin) + 1e-3)).unknownGeography

  it('eases a standalone edge over the same on-screen (warped) width at any era', () => {
    const recent = justInsideYoungerEdge(2e5)
    const deep = justInsideYoungerEdge(1e9)
    expect(recent).toBeGreaterThan(0)
    expect(recent).toBeLessThan(1)
    expect(deep).toBeCloseTo(recent, 6)
  })
})
