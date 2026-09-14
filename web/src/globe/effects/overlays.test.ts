import { describe, expect, it } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import { EFFECT_EVENTS, REGIME_EVENTS } from './fixtures'
import {
  anchorUv,
  giantImpactFlash,
  ICE_SHELL_EASE_YEARS,
  iceShellIntensity,
  IMPACT_WINTER_DARK_YEARS,
  IMPACT_WINTER_RECOVERY_YEARS,
  impactWinterAnchor,
  impactWinterFlash,
  impactWinterVeil,
} from './overlays'

const SNOWBALL = EFFECT_EVENTS.find((e) => e.id === 'snowball-earth')!
const K_PG = EFFECT_EVENTS.find((e) => e.id === 'k-pg-impact')!
const MOON_IMPACT = EFFECT_EVENTS.find((e) => e.id === 'moon-forming-impact')!
const PALEOPROTEROZOIC = REGIME_EVENTS.find((e) => e.id === 'paleoproterozoic-glaciation-regime')!

describe('iceShellIntensity', () => {
  it('is 0 far from every ice-shell window', () => {
    expect(iceShellIntensity(EFFECT_EVENTS, 5e8)).toBe(0)
  })

  it('is 1 throughout the Sturtian window', () => {
    expect(iceShellIntensity([SNOWBALL], 6.9e8)).toBe(1)
    expect(iceShellIntensity([SNOWBALL], 7.17e8)).toBe(1)
    expect(iceShellIntensity([SNOWBALL], 6.61e8)).toBe(1)
  })

  it('is 1 throughout the (separate, narrower) Marinoan window', () => {
    expect(iceShellIntensity([SNOWBALL], 6.37e8)).toBe(1)
  })

  it('is 0 in the gap between Sturtian and Marinoan, both well outside their ease widths', () => {
    // The gap [6.39e8, 6.61e8] is 22 Myr wide, comfortably more than 2x the 3 Myr ease.
    expect(iceShellIntensity([SNOWBALL], 6.5e8)).toBe(0)
  })

  it('eases out smoothly just past a window edge, reaching 0 by the ease width', () => {
    const justOutside = iceShellIntensity([SNOWBALL], 7.17e8 + ICE_SHELL_EASE_YEARS / 2)
    expect(justOutside).toBeGreaterThan(0)
    expect(justOutside).toBeLessThan(1)
    expect(iceShellIntensity([SNOWBALL], 7.17e8 + ICE_SHELL_EASE_YEARS)).toBe(0)
  })

  it('unions the Paleoproterozoic glaciation regime in when that event list is passed too', () => {
    expect(iceShellIntensity([PALEOPROTEROZOIC], 2.44e9)).toBe(1)
    expect(iceShellIntensity([PALEOPROTEROZOIC], 5e8)).toBe(0)
  })

  it('ignores events with no ice-shell effect', () => {
    expect(iceShellIntensity([MOON_IMPACT], 4.4e9)).toBe(0)
  })

  it('is pure in t', () => {
    expect(iceShellIntensity(EFFECT_EVENTS, 7e8)).toBe(iceShellIntensity(EFFECT_EVENTS, 7e8))
  })
})

describe('impactWinterVeil', () => {
  const tImpact = (K_PG.tMin + K_PG.tMax) / 2 // Renne et al. 2013's 66.043 Ma

  it('is 0 before the impact', () => {
    expect(impactWinterVeil([K_PG], tImpact + 1)).toBe(0)
  })

  it('is 1 (near-black) immediately after impact and through the dark phase', () => {
    expect(impactWinterVeil([K_PG], tImpact)).toBe(1)
    expect(impactWinterVeil([K_PG], tImpact - IMPACT_WINTER_DARK_YEARS)).toBe(1)
  })

  it('eases down during the recovery window and reaches 0 by its end', () => {
    const midRecovery = impactWinterVeil([K_PG], tImpact - (IMPACT_WINTER_DARK_YEARS + IMPACT_WINTER_RECOVERY_YEARS) / 2)
    expect(midRecovery).toBeGreaterThan(0)
    expect(midRecovery).toBeLessThan(1)
    expect(impactWinterVeil([K_PG], tImpact - IMPACT_WINTER_RECOVERY_YEARS)).toBe(0)
    expect(impactWinterVeil([K_PG], tImpact - IMPACT_WINTER_RECOVERY_YEARS - 5)).toBe(0)
  })

  it('is monotonically non-increasing after the dark phase', () => {
    const samples = [0, 3, 6, 9, 12, 15, 18].map((yearsAfter) => impactWinterVeil([K_PG], tImpact - yearsAfter))
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]!)
    }
  })

  it('ignores events with no impact-winter effect', () => {
    expect(impactWinterVeil([MOON_IMPACT, SNOWBALL], tImpact)).toBe(0)
  })
})

describe('impactWinterFlash', () => {
  const tImpact = (K_PG.tMin + K_PG.tMax) / 2

  it('is 0 before the impact', () => {
    expect(impactWinterFlash([K_PG], tImpact + 1)).toBe(0)
  })

  it('peaks at the impact moment and decays quickly (days, not years)', () => {
    expect(impactWinterFlash([K_PG], tImpact)).toBeCloseTo(1, 5)
    const oneYearLater = impactWinterFlash([K_PG], tImpact - 1)
    expect(oneYearLater).toBeLessThan(0.01)
  })
})

describe('impactWinterAnchor', () => {
  it("returns k-pg-impact's anchor", () => {
    expect(impactWinterAnchor(EFFECT_EVENTS)).toEqual({ lat: 21.3, lon: -89.5 })
  })

  it('is null when no event carries an anchored impact-winter effect', () => {
    expect(impactWinterAnchor([MOON_IMPACT, SNOWBALL])).toBeNull()
    expect(impactWinterAnchor([])).toBeNull()
  })
})

describe('anchorUv', () => {
  it('maps lat 0, lon 0 to the uv centre', () => {
    expect(anchorUv({ lat: 0, lon: 0 })).toEqual({ u: 0.5, v: 0.5 })
  })

  it('maps the poles to v = 0 (north) and v = 1 (south)', () => {
    expect(anchorUv({ lat: 90, lon: 0 }).v).toBeCloseTo(0)
    expect(anchorUv({ lat: -90, lon: 0 }).v).toBeCloseTo(1)
  })

  it('wraps longitude across the antimeridian into 0..1', () => {
    // lon 179 and lon -179 are 2 degrees apart in reality (both near the antimeridian); their
    // u values land near opposite ends of 0..1, close only once the wrap is accounted for —
    // the same wraparound distance shaders.ts's fragment shader computes for the flash glow.
    const east = anchorUv({ lat: 0, lon: 179 })
    const west = anchorUv({ lat: 0, lon: -179 })
    expect(east.u).toBeGreaterThanOrEqual(0)
    expect(east.u).toBeLessThanOrEqual(1)
    expect(west.u).toBeGreaterThanOrEqual(0)
    expect(west.u).toBeLessThanOrEqual(1)
    const rawDelta = Math.abs(east.u - west.u)
    const wrappedDelta = Math.min(rawDelta, 1 - rawDelta)
    expect(wrappedDelta).toBeLessThan(0.02)
  })
})

describe('giantImpactFlash', () => {
  const window = MOON_IMPACT.effect!.windows[0]!

  it('is 0 outside the effect window', () => {
    expect(giantImpactFlash([MOON_IMPACT], window.tMax + 1)).toBe(0)
    expect(giantImpactFlash([MOON_IMPACT], window.tMin - 1)).toBe(0)
  })

  it('peaks at the older edge of the window and decays towards the present', () => {
    expect(giantImpactFlash([MOON_IMPACT], window.tMax)).toBeCloseTo(1, 5)
    const samples = [0, 1e6, 2e6, 5e7, 1e8].map((sinceImpact) => giantImpactFlash([MOON_IMPACT], window.tMax - sinceImpact))
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]!)
    }
    expect(samples[samples.length - 1]!).toBeLessThan(0.01)
  })

  it('ignores events with no giant-impact effect', () => {
    const events: readonly TimelineEvent[] = [K_PG, SNOWBALL]
    expect(giantImpactFlash(events, window.tMax)).toBe(0)
  })
})
