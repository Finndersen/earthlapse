import { describe, expect, it } from 'vitest'

import { selectBasemapTier, supportsBasemapT1 } from './deviceTier'

describe('supportsBasemapT1', () => {
  it('is true only once the GPU can hold a 4096px-square texture', () => {
    expect(supportsBasemapT1(2048)).toBe(false)
    expect(supportsBasemapT1(4095)).toBe(false)
    expect(supportsBasemapT1(4096)).toBe(true)
    expect(supportsBasemapT1(8192)).toBe(true)
  })

})

describe('selectBasemapTier', () => {
  it('is T0 whenever the orb is minimised, regardless of GPU capability', () => {
    expect(selectBasemapTier(false, true)).toBe('basemap_t0')
    expect(selectBasemapTier(false, false)).toBe('basemap_t0')
  })

  it('is T1 once expanded, on any device whose GPU supports it', () => {
    expect(selectBasemapTier(true, true)).toBe('basemap_t1')
  })
})
