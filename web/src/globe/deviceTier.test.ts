import { describe, expect, it } from 'vitest'

import { selectBasemapTier, supportsBasemapT1 } from './deviceTier'

describe('supportsBasemapT1', () => {
  it('is true only once the GPU can hold a 4096px-square texture', () => {
    expect(supportsBasemapT1(2048)).toBe(false)
    expect(supportsBasemapT1(4095)).toBe(false)
    expect(supportsBasemapT1(4096)).toBe(true)
    expect(supportsBasemapT1(8192)).toBe(true)
  })

  it('is false for maxTextureSize 0 (probeWebgl\'s own "could not open a context at all" case)', () => {
    expect(supportsBasemapT1(0)).toBe(false)
  })
})

describe('selectBasemapTier', () => {
  it('is T0 whenever the orb is minimised, regardless of device', () => {
    expect(selectBasemapTier(false, false, true)).toBe('basemap_t0')
    expect(selectBasemapTier(false, true, true)).toBe('basemap_t0')
  })

  it('is T0 expanded on a phone, even when the GPU could hold T1', () => {
    expect(selectBasemapTier(true, true, true)).toBe('basemap_t0')
  })

  it('is T0 expanded on desktop when the GPU cannot hold a 4096px texture', () => {
    expect(selectBasemapTier(true, false, false)).toBe('basemap_t0')
  })

  it('is T1 only when expanded, not a phone, and the GPU supports it', () => {
    expect(selectBasemapTier(true, false, true)).toBe('basemap_t1')
  })
})
