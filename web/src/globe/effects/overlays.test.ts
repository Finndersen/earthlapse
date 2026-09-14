import { describe, expect, it } from 'vitest'

import type { GeoTime, TimelineEvent } from '@/types/layer'

import { EFFECT_EVENTS, REGIME_EVENTS } from './fixtures'
import { SYMLOG_C, symlogWarp } from './math'
import {
  anchorUv,
  giantImpactFlash,
  ICE_SHELL_EASE_WARP,
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

/** Inverse of `symlogWarp`, for building test times a given warp-space distance from an edge —
 *  the same "constant width in warp space" the ease itself is now sized in (`overlays.ts`). */
function unwarp(w: number): GeoTime {
  return SYMLOG_C * Math.expm1(w)
}

/** `edge`, offset by `warpFraction` of a full ease width in warp space (toward older `t`). */
function pastEdge(edge: GeoTime, warpFraction: number): GeoTime {
  return unwarp(symlogWarp(edge) + warpFraction * ICE_SHELL_EASE_WARP)
}

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

  it('eases out smoothly just past a window edge, reaching 0 by the warp ease width', () => {
    const justOutside = iceShellIntensity([SNOWBALL], pastEdge(7.17e8, 0.5))
    expect(justOutside).toBeGreaterThan(0)
    expect(justOutside).toBeLessThan(1)
    expect(iceShellIntensity([SNOWBALL], pastEdge(7.17e8, 1))).toBe(0)
  })

  it('eases at a constant width in warp space, not a fixed number of years (regression: a fixed-year ease goes sub-pixel deep in time, which read as an abrupt Snowball on/off during playback)', () => {
    // Sturtian's older edge (~717 Ma) vs the Paleoproterozoic glaciation's (~2.46 Ga): a fixed
    // real-year ease width would put these tens of millions of years apart; a warp-space ease
    // instead lands within the same fraction of a percent of full intensity at the same warp
    // distance from each edge, at either era.
    const sturtianHalfEase = iceShellIntensity([SNOWBALL], pastEdge(7.17e8, 0.5))
    const paleoproterozoicHalfEase = iceShellIntensity([PALEOPROTEROZOIC], pastEdge(2.46e9, 0.5))
    expect(sturtianHalfEase).toBeCloseTo(paleoproterozoicHalfEase, 2)
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

  it('is 0 exactly at the impact instant (regression: the pre-impact kpg-arrival scene sits exactly here and must show the clear globe, not a post-impact one)', () => {
    expect(impactWinterVeil([K_PG], tImpact)).toBe(0)
  })

  it('is 1 (near-black) moments after impact and through the dark phase', () => {
    expect(impactWinterVeil([K_PG], tImpact - 1e-8)).toBe(1)
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
    // Starts a hair after the impact rather than exactly at it: `yearsAfter === 0` is the
    // special-cased pre-impact instant (0, not the dark phase's 1), which would otherwise
    // read as an increase into the very next sample.
    const samples = [1e-6, 3, 6, 9, 12, 15, 18].map((yearsAfter) => impactWinterVeil([K_PG], tImpact - yearsAfter))
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

  it('is 0 exactly at the impact instant (regression: the pre-impact kpg-arrival scene sits exactly here)', () => {
    expect(impactWinterFlash([K_PG], tImpact)).toBe(0)
  })

  it('peaks moments after the impact and decays quickly (days, not years)', () => {
    expect(impactWinterFlash([K_PG], tImpact - 1e-8)).toBeCloseTo(1, 5)
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
