import { describe, expect, it } from 'vitest'

import { HUD_HIDDEN_LAYER_IDS, isHiddenFromHud, isReadoutHiddenAt } from './hudVisibility'

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

describe('isReadoutHiddenAt', () => {
  const domain: [number, number] = [10, 12000]

  it('hides a readout older than its domain start and shows it at or inside the domain', () => {
    expect(isReadoutHiddenAt(domain, 3.45e9)).toBe(true)
    expect(isReadoutHiddenAt(domain, 12001)).toBe(true)
    expect(isReadoutHiddenAt(domain, 12000)).toBe(false)
    expect(isReadoutHiddenAt(domain, 0)).toBe(false)
  })
})
