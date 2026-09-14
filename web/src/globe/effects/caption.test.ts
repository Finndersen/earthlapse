import { describe, expect, it } from 'vitest'

import { EFFECT_EVENTS, REGIME_EVENTS } from './fixtures'
import { globeEffectCaption } from './caption'
import type { RegimeWeights } from './regimes'

const NO_REGIME: RegimeWeights = { magmaOcean: 0, waterWorld: 0, archean: 0, unknownGeography: 0 }
const ALL_EVENTS = [...REGIME_EVENTS, ...EFFECT_EVENTS]

describe('globeEffectCaption', () => {
  it('falls back when nothing is active', () => {
    expect(
      globeEffectCaption(
        { t: 0, regimeWeights: NO_REGIME, iceShellEvents: ALL_EVENTS, iceShellIntensity: 0, impactWinterVeil: 0 },
        'No reconstruction before 540 Ma',
      ),
    ).toBe('No reconstruction before 540 Ma')
  })

  it('matches docs/GLOBE.md §7 exact wording for the magma ocean regime', () => {
    const weights: RegimeWeights = { ...NO_REGIME, magmaOcean: 0.9 }
    const caption = globeEffectCaption(
      { t: 4.45e9, regimeWeights: weights, iceShellEvents: ALL_EVENTS, iceShellIntensity: 0, impactWinterVeil: 0 },
      '',
    )
    expect(caption).toBe('Magma ocean')
  })

  it('matches docs/GLOBE.md §7 exact wording for the unknown-geography regime', () => {
    const weights: RegimeWeights = { ...NO_REGIME, unknownGeography: 1 }
    const caption = globeEffectCaption(
      { t: 1.7e9, regimeWeights: weights, iceShellEvents: ALL_EVENTS, iceShellIntensity: 0, impactWinterVeil: 0 },
      '',
    )
    expect(caption).toBe('Geography unknown')
  })

  it('does not caption a regime that is only a minority of a crossfade', () => {
    const weights: RegimeWeights = { ...NO_REGIME, magmaOcean: 0.4, waterWorld: 0.4 }
    const caption = globeEffectCaption(
      { t: 4.375e9, regimeWeights: weights, iceShellEvents: ALL_EVENTS, iceShellIntensity: 0, impactWinterVeil: 0 },
      'fallback',
    )
    expect(caption).toBe('fallback')
  })

  it('captions Snowball Earth with the "extent contested" convention', () => {
    const caption = globeEffectCaption(
      { t: 6.9e8, regimeWeights: NO_REGIME, iceShellEvents: ALL_EVENTS, iceShellIntensity: 1, impactWinterVeil: 0 },
      '',
    )
    expect(caption).toBe('Snowball Earth · extent contested')
  })

  it('captions the Paleoproterozoic glaciation regime with the same "extent contested" convention', () => {
    const caption = globeEffectCaption(
      { t: 2.44e9, regimeWeights: NO_REGIME, iceShellEvents: ALL_EVENTS, iceShellIntensity: 1, impactWinterVeil: 0 },
      '',
    )
    expect(caption).toBe('Paleoproterozoic glaciation · extent contested')
  })

  it('captions impact winter, taking priority over a simultaneously-active regime', () => {
    const weights: RegimeWeights = { ...NO_REGIME, magmaOcean: 1 }
    const caption = globeEffectCaption(
      { t: 4.4e9, regimeWeights: weights, iceShellEvents: ALL_EVENTS, iceShellIntensity: 0, impactWinterVeil: 0.8 },
      '',
    )
    expect(caption).toBe('Impact winter')
  })

  it('captions impact winter over ice shell too', () => {
    const caption = globeEffectCaption(
      { t: 6.9e8, regimeWeights: NO_REGIME, iceShellEvents: ALL_EVENTS, iceShellIntensity: 1, impactWinterVeil: 0.5 },
      '',
    )
    expect(caption).toBe('Impact winter')
  })
})
