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

/** `edge`, offset by `warpFraction` of a full ease width in warp space toward older t. */
function pastEdge(edge: GeoTime, warpFraction: number): GeoTime {
  return SYMLOG_C * Math.expm1(symlogWarp(edge) + warpFraction * ICE_SHELL_EASE_WARP)
}

describe('iceShellIntensity', () => {
  it('is 1 inside each glaciation window and 0 in the gaps and far away', () => {
    for (const t of [6.9e8, 7.17e8, 6.61e8, 6.37e8]) expect(iceShellIntensity([SNOWBALL], t)).toBe(1)
    expect(iceShellIntensity([SNOWBALL], 6.5e8)).toBe(0)
    expect(iceShellIntensity(EFFECT_EVENTS, 5e8)).toBe(0)
    expect(iceShellIntensity([PALEOPROTEROZOIC], 2.44e9)).toBe(1)
    expect(iceShellIntensity([MOON_IMPACT], 4.4e9)).toBe(0)
  })

  it('eases out over a constant warp-space width, the same at any era', () => {
    const sturtian = iceShellIntensity([SNOWBALL], pastEdge(7.17e8, 0.5))
    expect(sturtian).toBeGreaterThan(0)
    expect(sturtian).toBeLessThan(1)
    expect(iceShellIntensity([SNOWBALL], pastEdge(7.17e8, 1))).toBe(0)
    expect(iceShellIntensity([PALEOPROTEROZOIC], pastEdge(2.46e9, 0.5))).toBeCloseTo(sturtian, 2)
  })
})

describe('impact winter', () => {
  const tImpact = (K_PG.tMin + K_PG.tMax) / 2

  it('shows nothing before or exactly at the impact instant', () => {
    for (const t of [tImpact + 1, tImpact]) {
      expect(impactWinterVeil([K_PG], t)).toBe(0)
      expect(impactWinterFlash([K_PG], t)).toBe(0)
    }
  })

  it('flashes immediately after impact, decaying within a year', () => {
    expect(impactWinterFlash([K_PG], tImpact - 1e-8)).toBeCloseTo(1, 5)
    expect(impactWinterFlash([K_PG], tImpact - 1)).toBeLessThan(0.01)
  })

  it('veils fully through the dark phase then eases monotonically to 0 by the end of recovery', () => {
    expect(impactWinterVeil([K_PG], tImpact - 1e-8)).toBe(1)
    expect(impactWinterVeil([K_PG], tImpact - IMPACT_WINTER_DARK_YEARS)).toBe(1)
    const samples = [1e-6, 3, 6, 9, 12, 15, 18].map((years) => impactWinterVeil([K_PG], tImpact - years))
    for (let i = 1; i < samples.length; i++) expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]!)
    expect(impactWinterVeil([K_PG], tImpact - IMPACT_WINTER_RECOVERY_YEARS)).toBe(0)
    expect(impactWinterVeil([MOON_IMPACT, SNOWBALL], tImpact)).toBe(0)
  })

  it("anchors on k-pg-impact's location, or null without one", () => {
    expect(impactWinterAnchor(EFFECT_EVENTS)).toEqual({ lat: 21.3, lon: -89.5 })
    expect(impactWinterAnchor([MOON_IMPACT, SNOWBALL])).toBeNull()
  })
})

describe('anchorUv', () => {
  it('maps the centre, poles and east to the globe texture uv', () => {
    expect(anchorUv({ lat: 0, lon: 0 })).toEqual({ u: 0.5, v: 0.5 })
    expect(anchorUv({ lat: 90, lon: 0 }).v).toBeCloseTo(0)
    expect(anchorUv({ lat: -90, lon: 0 }).v).toBeCloseTo(1)
    expect(anchorUv({ lat: 0, lon: 90 }).u).toBeGreaterThan(0.5)
  })

  it('keeps the antimeridian close once wrapped', () => {
    const delta = Math.abs(anchorUv({ lat: 0, lon: 179 }).u - anchorUv({ lat: 0, lon: -179 }).u)
    expect(Math.min(delta, 1 - delta)).toBeLessThan(0.02)
  })
})

describe('giantImpactFlash', () => {
  const window = MOON_IMPACT.effect!.windows[0]!

  it('peaks at the window’s older edge and decays toward the present, 0 outside', () => {
    expect(giantImpactFlash([MOON_IMPACT], window.tMax + 1)).toBe(0)
    expect(giantImpactFlash([MOON_IMPACT], window.tMin - 1)).toBe(0)
    const samples = [0, 1e6, 5e7, 1e8].map((since) => giantImpactFlash([MOON_IMPACT], window.tMax - since))
    expect(samples[0]).toBeCloseTo(1, 5)
    for (let i = 1; i < samples.length; i++) expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]!)
    expect(samples.at(-1)!).toBeLessThan(0.01)
    const others: readonly TimelineEvent[] = [K_PG, SNOWBALL]
    expect(giantImpactFlash(others, window.tMax)).toBe(0)
  })
})
