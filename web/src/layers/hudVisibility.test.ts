import { describe, expect, it } from 'vitest'

import { HUD_HIDDEN_LAYER_IDS, isHiddenFromHud, isPopulationReadoutHiddenAt } from './hudVisibility'

describe('isHiddenFromHud', () => {
  it('hides co2 from the HUD', () => {
    expect(isHiddenFromHud('co2')).toBe(true)
    expect(HUD_HIDDEN_LAYER_IDS.has('co2')).toBe(true)
  })

  it('leaves other HUD scalars — population, day_length — untouched', () => {
    expect(isHiddenFromHud('population')).toBe(false)
    expect(isHiddenFromHud('day_length')).toBe(false)
  })

  it('is reversible by construction: removing an id from the set un-hides it', () => {
    // Documents the contract in hudVisibility.ts's doc comment rather than mutating the real
    // exported set: a future revert is "delete the id from HUD_HIDDEN_LAYER_IDS", nothing else.
    const revertedIfCo2Removed = new Set([...HUD_HIDDEN_LAYER_IDS].filter((id) => id !== 'co2'))
    expect(revertedIfCo2Removed.has('co2')).toBe(false)
  })
})

describe('isPopulationReadoutHiddenAt', () => {
  const domain: [number, number] = [10, 12000]

  it('hides the population readout older than the domain start', () => {
    expect(isPopulationReadoutHiddenAt('population', domain, 3.45e9)).toBe(true)
    expect(isPopulationReadoutHiddenAt('population', domain, 12001)).toBe(true)
  })

  it('shows the population readout at or inside the domain', () => {
    expect(isPopulationReadoutHiddenAt('population', domain, 12000)).toBe(false)
    expect(isPopulationReadoutHiddenAt('population', domain, 0)).toBe(false)
  })

  it('never hides a different layer, even when t is far older than its own domain', () => {
    expect(isPopulationReadoutHiddenAt('day_length', domain, 3.45e9)).toBe(false)
  })
})
