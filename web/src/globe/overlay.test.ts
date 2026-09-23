import { describe, expect, it } from 'vitest'

import type { RasterData } from '@/data/curated'

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
  it('has a spec keyed by each kind, with a distinct shader discriminator', () => {
    expect(overlayKindUniform('population_density')).toBe(0)
    expect(overlayKindUniform('cleared_land')).toBe(1)
    for (const kind of GLOBE_OVERLAY_KINDS) expect(GLOBE_OVERLAYS[kind].kind).toBe(kind)
    expect(Object.keys(GLOBE_OVERLAYS).sort()).toEqual([...GLOBE_OVERLAY_KINDS].sort())
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

  it('eases linearly to 0 across a fade band older than the oldest frame', () => {
    expect(overlayStrengthAt(OVERLAY_DATA, OLDEST_T + OVERLAY_FADE_BAND_YEARS / 4)).toBeCloseTo(0.75)
    expect(overlayStrengthAt(OVERLAY_DATA, OLDEST_T + OVERLAY_FADE_BAND_YEARS)).toBe(0)
    expect(overlayHasDataAt(OVERLAY_DATA, OLDEST_T + OVERLAY_FADE_BAND_YEARS + 1)).toBe(false)
    expect(overlayHasDataAt(null, 0)).toBe(false)
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
