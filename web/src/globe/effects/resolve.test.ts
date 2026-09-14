import { describe, expect, it } from 'vitest'

import { EFFECT_EVENTS, REGIME_EVENTS } from './fixtures'
import { resolveGlobeEffects } from './resolve'

describe('resolveGlobeEffects', () => {
  it('is inert (matches the pre-G6/G8 look) well inside the plain PaleoDEM domain', () => {
    const { uniforms, caption } = resolveGlobeEffects(1e8, REGIME_EVENTS, EFFECT_EVENTS, '')
    expect(uniforms).toEqual({
      regimeWeights: { magmaOcean: 0, waterWorld: 0, archean: 0, unknownGeography: 0 },
      iceShell: 0,
      impactWinterVeil: 0,
      impactFlash: 0,
      impactFlashAnchorUv: null,
      giantImpactFlash: 0,
    })
    expect(caption).toBe('')
  })

  it('falls back to the caller-supplied caption when nothing is active', () => {
    const { caption } = resolveGlobeEffects(1e8, REGIME_EVENTS, EFFECT_EVENTS, 'No reconstruction before 540 Ma')
    expect(caption).toBe('No reconstruction before 540 Ma')
  })

  it('resolves the giant-impact flash at the older edge of its window, where the regime is only just fading in', () => {
    const window = EFFECT_EVENTS.find((e) => e.id === 'moon-forming-impact')!.effect!.windows[0]!
    const { uniforms } = resolveGlobeEffects(window.tMax, REGIME_EVENTS, EFFECT_EVENTS, '')
    expect(uniforms.giantImpactFlash).toBeCloseTo(1, 5)
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

  it('captions the Paleoproterozoic glaciation over its enclosing Archean regime (regression: its window sits entirely inside archean-haze-regime, so the regime weight there is ~1 too — the ice shell must still win the caption, not just the shader look)', () => {
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

  it('is inert exactly at the impact instant (regression: the pre-impact kpg-arrival scene sits exactly here and must show the clear, pre-impact globe)', () => {
    const kPg = EFFECT_EVENTS.find((e) => e.id === 'k-pg-impact')!
    const tImpact = (kPg.tMin + kPg.tMax) / 2
    const { uniforms, caption } = resolveGlobeEffects(tImpact, REGIME_EVENTS, EFFECT_EVENTS, 'fallback')
    expect(uniforms.impactWinterVeil).toBe(0)
    expect(uniforms.impactFlash).toBe(0)
    expect(uniforms.impactFlashAnchorUv).toBeNull()
    expect(caption).toBe('fallback')
  })

  it('is pure in t: identical inputs give identical output', () => {
    const a = resolveGlobeEffects(4.1e9, REGIME_EVENTS, EFFECT_EVENTS, 'fallback')
    const b = resolveGlobeEffects(4.1e9, REGIME_EVENTS, EFFECT_EVENTS, 'fallback')
    expect(a).toEqual(b)
  })
})
