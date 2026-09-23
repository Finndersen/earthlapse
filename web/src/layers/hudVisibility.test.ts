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

})
