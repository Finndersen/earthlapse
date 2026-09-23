import { describe, expect, it } from 'vitest'

import { EFFECT_EVENTS, REGIME_EVENTS } from './fixtures'
import { resolveGlobeEffects } from './resolve'

describe('resolveGlobeEffects', () => {
  it('is inert inside the plain PaleoDEM domain, keeping the fallback caption', () => {
    const { uniforms, caption } = resolveGlobeEffects(1e8, REGIME_EVENTS, EFFECT_EVENTS, 'fallback')
    expect(uniforms).toEqual({
      regimeWeights: { magmaOcean: 0, waterWorld: 0, archean: 0, unknownGeography: 0 },
      iceShell: 0,
      impactWinterVeil: 0,
      impactFlash: 0,
      impactFlashAnchorUv: null,
      giantImpactFlash: 0,
    })
    expect(caption).toBe('fallback')
  })

  it('resolves the magma-ocean regime deep in its interior, its caption dominant and the flash long decayed', () => {
    const { uniforms, caption } = resolveGlobeEffects(4.45e9, REGIME_EVENTS, EFFECT_EVENTS, '')
    expect(uniforms.regimeWeights.magmaOcean).toBeCloseTo(1, 2)
    expect(uniforms.giantImpactFlash).toBeLessThan(0.01)
    expect(caption).toBe('Magma ocean')
  })

  it('resolves the Snowball Earth ice shell with its caption', () => {
    const { uniforms, caption } = resolveGlobeEffects(6.9e8, REGIME_EVENTS, EFFECT_EVENTS, '')
    expect(uniforms.iceShell).toBe(1)
    expect(caption).toBe('Snowball Earth · extent contested')
  })

  it('captions an ice shell over the regime that encloses it', () => {
    const { uniforms, caption } = resolveGlobeEffects(2.44e9, REGIME_EVENTS, EFFECT_EVENTS, '')
    expect(uniforms.regimeWeights.archean).toBeGreaterThan(0.5)
    expect(uniforms.iceShell).toBe(1)
    expect(caption).toBe('Paleoproterozoic glaciation · extent contested')
  })

  it('resolves the K-Pg impact winter veil, flash and anchor together', () => {
    const kPg = EFFECT_EVENTS.find((e) => e.id === 'k-pg-impact')!
    const tImpact = (kPg.tMin + kPg.tMax) / 2
    const { uniforms, caption } = resolveGlobeEffects(tImpact - 1e-8, REGIME_EVENTS, EFFECT_EVENTS, '')
    expect(uniforms.impactWinterVeil).toBe(1)
    expect(uniforms.impactFlash).toBeCloseTo(1, 5)
    expect(uniforms.impactFlashAnchorUv).not.toBeNull()
    expect(caption).toBe('Impact winter')
  })

  it('is inert exactly at the impact instant', () => {
    const kPg = EFFECT_EVENTS.find((e) => e.id === 'k-pg-impact')!
    const tImpact = (kPg.tMin + kPg.tMax) / 2
    const { uniforms, caption } = resolveGlobeEffects(tImpact, REGIME_EVENTS, EFFECT_EVENTS, 'fallback')
    expect(uniforms.impactWinterVeil).toBe(0)
    expect(uniforms.impactFlash).toBe(0)
    expect(uniforms.impactFlashAnchorUv).toBeNull()
    expect(caption).toBe('fallback')
  })

})
