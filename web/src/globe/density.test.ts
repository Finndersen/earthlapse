import { describe, expect, it } from 'vitest'

import { decodeLogDensity, type RasterData } from '@/data/curated'

import {
  DENSITY_FADE_BAND_YEARS,
  DENSITY_RAMP,
  DENSITY_RAMP_GLSL,
  decodeDensityTexel,
  densityBlendAt,
  densityChannelMask,
  densityHasDataAt,
  densityRampAt,
  densityStrengthAt,
} from './density'

// --------------------------------------------------------------------------------- densityRampAt

describe('densityRampAt', () => {
  it('is flat at the floor for any density at or below the first stop', () => {
    const first = DENSITY_RAMP[0]!
    const floor = [...first.color, first.alpha]
    expect(densityRampAt(first.density)).toEqual(floor)
    expect(densityRampAt(0)).toEqual(floor)
    expect(densityRampAt(-5)).toEqual(floor)
  })

  it('is flat at the ceiling for any density at or above the last stop', () => {
    const last = DENSITY_RAMP[DENSITY_RAMP.length - 1]!
    const [r, g, b, a] = densityRampAt(last.density * 1000)
    expect(r).toBeCloseTo(last.color[0], 6)
    expect(g).toBeCloseTo(last.color[1], 6)
    expect(b).toBeCloseTo(last.color[2], 6)
    expect(a).toBeCloseTo(last.alpha, 6)
  })

  it('hits every stop’s own colour and alpha exactly at its own density', () => {
    for (const stop of DENSITY_RAMP) {
      const [r, g, b, a] = densityRampAt(stop.density)
      expect(r).toBeCloseTo(stop.color[0], 6)
      expect(g).toBeCloseTo(stop.color[1], 6)
      expect(b).toBeCloseTo(stop.color[2], 6)
      expect(a).toBeCloseTo(stop.alpha, 6)
    }
  })

  it('alpha is monotonically non-decreasing across the whole ramp', () => {
    let previous = -Infinity
    for (let d = 0; d <= 10_000; d += 20) {
      const alpha = densityRampAt(d)[3]
      expect(alpha).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = alpha
    }
  })
})

describe('DENSITY_RAMP_GLSL', () => {
  it('contains exactly one mix( per ramp interval, generated from the same stop list', () => {
    const mixCount = (DENSITY_RAMP_GLSL.match(/mix\(/g) ?? []).length
    expect(mixCount).toBe(DENSITY_RAMP.length - 1)
  })
})

// ------------------------------------------------------------------------------------- ramp hue

/** ITU-R BT.601 luma of an authored (gamma-encoded) hex colour — the same "how does this read
 *  converted to greyscale" approximation most software uses, distinct from the linear-light
 *  `srgbHexToLinear` the shader itself composites in. */
function luma(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return 0.299 * r + 0.587 * g + 0.114 * b
}

describe('DENSITY_RAMP hue and lightness — reads as an artificial overlay, not terrain', () => {
  it('is monotonically non-decreasing in luma from the darkest to the palest stop', () => {
    let previous = -Infinity
    for (const s of DENSITY_RAMP) {
      const value = luma(s.hex)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })

  it('stays in the violet-magenta-pink family and clear of arrivals amber / cities cyan', () => {
    // Every stop's hex is a shade of violet/magenta/pink: red channel at or above blue, and
    // green always the smallest channel (what keeps the family out of amber/tan/cyan territory).
    for (const s of DENSITY_RAMP) {
      const value = Number.parseInt(s.hex.slice(1), 16)
      const r = (value >> 16) & 0xff
      const g = (value >> 8) & 0xff
      const b = value & 0xff
      expect(g).toBeLessThanOrEqual(r)
      expect(g).toBeLessThanOrEqual(b)
    }
  })
})

// ------------------------------------------------------------------------------ decodeLogDensity

/** The pipeline's own encode formula (`pipeline/density_encoding.py`, restated in
 *  `density.ts`'s own doc comment) — an independent reference, so round-tripping through it
 *  exercises `decodeLogDensity` against something other than its own inverse algebra. */
function encodeLogDensity(density: number, dMax: number): number {
  const logMax = Math.log10(1 + dMax)
  return Math.round(255 * (Math.log10(1 + Math.max(0, density)) / logMax))
}

describe('decodeLogDensity', () => {
  const D_MAX = 15_000

  it('round-trips the pipeline’s own encode formula, within one 8-bit quantisation step', () => {
    for (const density of [0, 1, 10, 100, 1000, 5000, 14_999]) {
      const byte = encodeLogDensity(density, D_MAX)
      const decoded = decodeLogDensity(byte / 255, D_MAX)
      expect(Math.abs(decoded - density) / (density + 1)).toBeLessThan(0.05)
    }
  })

  it('decodes byte 255 (unit sample 1) to exactly dMax', () => {
    expect(decodeLogDensity(1, D_MAX)).toBeCloseTo(D_MAX, 6)
  })

  it('decodes byte 0 (unit sample 0) to exactly 0', () => {
    expect(decodeLogDensity(0, D_MAX)).toBe(0)
  })

  it('clamps a unit sample outside 0..1 rather than extrapolating', () => {
    expect(decodeLogDensity(-1, D_MAX)).toBe(0)
    expect(decodeLogDensity(2, D_MAX)).toBeCloseTo(D_MAX, 6)
  })

  it('rejects a non-positive dMax', () => {
    expect(() => decodeLogDensity(0.5, 0)).toThrow(/dMax/)
    expect(() => decodeLogDensity(0.5, -10)).toThrow(/dMax/)
  })
})

// ------------------------------------------------------------------------------ densityChannelMask

describe('densityChannelMask', () => {
  it('selects exactly the published channel', () => {
    expect(densityChannelMask('r')).toEqual([1, 0, 0])
    expect(densityChannelMask('g')).toEqual([0, 1, 0])
    expect(densityChannelMask('b')).toEqual([0, 0, 1])
  })
})

// ---------------------------------------------------------------------------------- domain/binding

const DENSITY_DATA: RasterData = {
  id: 'hyde_population_density',
  frames: [
    { t: 0, ref: 'newest.png' },
    { t: 5000, ref: 'mid.png' },
    { t: 12_000, ref: 'oldest.png' },
  ],
  encoding: { channel: 'r', unit: 'people/km2', dMax: 15_000 },
}

const OLDEST_T = 12_000

describe('densityStrengthAt', () => {
  it('is 1 at and below the sequence’s oldest frame', () => {
    expect(densityStrengthAt(DENSITY_DATA, OLDEST_T)).toBe(1)
    expect(densityStrengthAt(DENSITY_DATA, 0)).toBe(1)
  })

  it('is 0 a full fade band older than the oldest frame', () => {
    expect(densityStrengthAt(DENSITY_DATA, OLDEST_T + DENSITY_FADE_BAND_YEARS)).toBe(0)
    expect(densityStrengthAt(DENSITY_DATA, OLDEST_T + DENSITY_FADE_BAND_YEARS + 1000)).toBe(0)
  })

  it('eases linearly across the band', () => {
    const midpoint = OLDEST_T + DENSITY_FADE_BAND_YEARS / 2
    expect(densityStrengthAt(DENSITY_DATA, midpoint)).toBeCloseTo(0.5)
    const quarter = OLDEST_T + DENSITY_FADE_BAND_YEARS / 4
    expect(densityStrengthAt(DENSITY_DATA, quarter)).toBeCloseTo(0.75)
  })
})

describe('densityBlendAt', () => {
  const ASSET_BASE = '/media'

  it('holds the newest frame from its own t through the present', () => {
    const blend = densityBlendAt(DENSITY_DATA, 0, ASSET_BASE)
    expect(blend).not.toBeNull()
    expect(blend!.beforeUrl).toBe(blend!.afterUrl)
    expect(blend!.beforeUrl).toContain('newest.png')
    expect(blend!.alpha).toBe(0)
  })

  it('holds the oldest frame across the whole fade-in band', () => {
    const blend = densityBlendAt(DENSITY_DATA, OLDEST_T + DENSITY_FADE_BAND_YEARS / 2, ASSET_BASE)
    expect(blend).not.toBeNull()
    expect(blend!.beforeUrl).toContain('oldest.png')
    expect(blend!.afterUrl).toContain('oldest.png')
  })

  it('is null once t is past the fade band entirely', () => {
    expect(densityBlendAt(DENSITY_DATA, OLDEST_T + DENSITY_FADE_BAND_YEARS + 1, ASSET_BASE)).toBeNull()
  })
})

describe('densityHasDataAt', () => {
  it('is false for null data', () => {
    expect(densityHasDataAt(null, 0)).toBe(false)
  })

  it('mirrors densityStrengthAt > 0 for real data', () => {
    expect(densityHasDataAt(DENSITY_DATA, 0)).toBe(true)
    expect(densityHasDataAt(DENSITY_DATA, OLDEST_T + DENSITY_FADE_BAND_YEARS + 1)).toBe(false)
  })
})

describe('decodeDensityTexel', () => {
  it('decodes a normalised texel using the raster’s own published encoding', () => {
    expect(decodeDensityTexel(DENSITY_DATA, 1)).toBeCloseTo(15_000, 6)
    expect(decodeDensityTexel(DENSITY_DATA, 0)).toBe(0)
  })

  it('throws when the raster publishes no encoding — a wiring bug, not a value to default', () => {
    const noEncoding: RasterData = { id: 'paleodem', frames: [{ t: 0, ref: 'a.png' }] }
    expect(() => decodeDensityTexel(noEncoding, 0.5)).toThrow(/encoding/)
  })
})
