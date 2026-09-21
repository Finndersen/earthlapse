import { describe, expect, it } from 'vitest'

import type { RasterData } from '@/data/curated'

import { CLEARED_LAND_RAMP, CLEARED_LAND_WEIGHTS } from './clearedLand'
import { DENSITY_RAMP } from './density'
import {
  GLOBE_OVERLAYS,
  GLOBE_OVERLAY_KINDS,
  OVERLAY_FADE_BAND_YEARS,
  overlayBlendAt,
  overlayHasDataAt,
  overlayKindUniform,
  overlayStrengthAt,
} from './overlay'

describe('GLOBE_OVERLAYS', () => {
  it('has a spec for every kind in GLOBE_OVERLAY_KINDS and vice versa', () => {
    expect(Object.keys(GLOBE_OVERLAYS).sort()).toEqual([...GLOBE_OVERLAY_KINDS].sort())
  })

  it('publishes the population density spec in full', () => {
    expect(GLOBE_OVERLAYS.population_density).toEqual({
      kind: 'population_density',
      layerId: 'hyde_population_density',
      label: 'Population density',
      sampling: { mode: 'log_encoded' },
      swatchHex: DENSITY_RAMP[4]!.hex,
    })
    expect(DENSITY_RAMP[4]!.hex).toBe('#f13fa8')
  })

  it('publishes the cleared land spec in full', () => {
    expect(GLOBE_OVERLAYS.cleared_land).toEqual({
      kind: 'cleared_land',
      layerId: 'hyde_cleared_land',
      label: 'Cleared land',
      sampling: { mode: 'linear_fraction', weights: CLEARED_LAND_WEIGHTS },
      swatchHex: CLEARED_LAND_RAMP[1]!.hex,
    })
    expect(CLEARED_LAND_RAMP[1]!.hex).toBe('#7c3632')
  })
})

describe('GLOBE_OVERLAY_KINDS', () => {
  it('lists population density before cleared land, the existing default first', () => {
    expect(GLOBE_OVERLAY_KINDS).toEqual(['population_density', 'cleared_land'])
  })
})

describe('overlayKindUniform', () => {
  it('maps population density to zero, matching WebGL’s zero-initialised uniform default', () => {
    expect(overlayKindUniform('population_density')).toBe(0)
  })

  it('maps cleared land to a distinct non-zero discriminator', () => {
    expect(overlayKindUniform('cleared_land')).toBe(1)
  })
})

// ---------------------------------------------------------------------------- domain and binding

const OVERLAY_DATA: RasterData = {
  id: 'hyde_population_density',
  frames: [
    { t: 0, ref: 'newest.png' },
    { t: 5000, ref: 'mid.png' },
    { t: 12_000, ref: 'oldest.png' },
  ],
  encoding: { channel: 'r', unit: 'people/km2', dMax: 15_000 },
}

const OLDEST_T = 12_000

describe('overlayStrengthAt', () => {
  it('is 1 at and below the sequence’s oldest frame', () => {
    expect(overlayStrengthAt(OVERLAY_DATA, OLDEST_T)).toBe(1)
    expect(overlayStrengthAt(OVERLAY_DATA, 0)).toBe(1)
  })

  it('is 0 a full fade band older than the oldest frame', () => {
    expect(overlayStrengthAt(OVERLAY_DATA, OLDEST_T + OVERLAY_FADE_BAND_YEARS)).toBe(0)
    expect(overlayStrengthAt(OVERLAY_DATA, OLDEST_T + OVERLAY_FADE_BAND_YEARS + 1000)).toBe(0)
  })

  it('eases linearly across the band', () => {
    const midpoint = OLDEST_T + OVERLAY_FADE_BAND_YEARS / 2
    expect(overlayStrengthAt(OVERLAY_DATA, midpoint)).toBeCloseTo(0.5)
    const quarter = OLDEST_T + OVERLAY_FADE_BAND_YEARS / 4
    expect(overlayStrengthAt(OVERLAY_DATA, quarter)).toBeCloseTo(0.75)
  })
})

describe('overlayBlendAt', () => {
  const ASSET_BASE = '/media'

  it('holds the newest frame from its own t through the present', () => {
    const blend = overlayBlendAt(OVERLAY_DATA, 0, ASSET_BASE)
    expect(blend).not.toBeNull()
    expect(blend!.beforeUrl).toBe(blend!.afterUrl)
    expect(blend!.beforeUrl).toContain('newest.png')
    expect(blend!.alpha).toBe(0)
  })

  it('holds the oldest frame across the whole fade-in band', () => {
    const blend = overlayBlendAt(OVERLAY_DATA, OLDEST_T + OVERLAY_FADE_BAND_YEARS / 2, ASSET_BASE)
    expect(blend).not.toBeNull()
    expect(blend!.beforeUrl).toContain('oldest.png')
    expect(blend!.afterUrl).toContain('oldest.png')
  })

  it('is null once t is past the fade band entirely', () => {
    expect(overlayBlendAt(OVERLAY_DATA, OLDEST_T + OVERLAY_FADE_BAND_YEARS + 1, ASSET_BASE)).toBeNull()
  })
})

describe('overlayHasDataAt', () => {
  it('is false for null data', () => {
    expect(overlayHasDataAt(null, 0)).toBe(false)
  })

  it('mirrors overlayStrengthAt > 0 for real data', () => {
    expect(overlayHasDataAt(OVERLAY_DATA, 0)).toBe(true)
    expect(overlayHasDataAt(OVERLAY_DATA, OLDEST_T + OVERLAY_FADE_BAND_YEARS + 1)).toBe(false)
  })
})
