import { describe, expect, it } from 'vitest'

import { decodeLogDensity, type RasterData } from '@/data/curated'

import { DENSITY_RAMP, DENSITY_RAMP_GLSL, decodeDensityTexel, densityChannelMask, densityRampAt } from './density'

describe('densityRampAt', () => {
  it('clamps to the end stops and hits each stop exactly', () => {
    const first = DENSITY_RAMP[0]!
    expect(densityRampAt(-5)).toEqual([...first.color, first.alpha])
    const last = DENSITY_RAMP.at(-1)!
    for (const [density, stop] of [...DENSITY_RAMP.map((s) => [s.density, s] as const), [last.density * 1000, last] as const]) {
      densityRampAt(density).forEach((v, i) => expect(v).toBeCloseTo([...stop.color, stop.alpha][i]!, 6))
    }
  })

  it('never decreases in alpha, and matches the GLSL ramp stop count', () => {
    let previous = -Infinity
    for (let d = 0; d <= 10_000; d += 20) {
      expect(densityRampAt(d)[3]).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = densityRampAt(d)[3]
    }
    expect((DENSITY_RAMP_GLSL.match(/mix\(/g) ?? []).length).toBe(DENSITY_RAMP.length - 1)
  })
})

/** The pipeline's encode formula, as an independent reference for decoding. */
function encodeLogDensity(density: number, dMax: number): number {
  return Math.round(255 * (Math.log10(1 + Math.max(0, density)) / Math.log10(1 + dMax)))
}

describe('decodeLogDensity', () => {
  const D_MAX = 15_000

  it('round-trips the pipeline encoding within one 8-bit step', () => {
    for (const density of [0, 10, 1000, 14_999]) {
      const decoded = decodeLogDensity(encodeLogDensity(density, D_MAX) / 255, D_MAX)
      expect(Math.abs(decoded - density) / (density + 1)).toBeLessThan(0.05)
    }
  })

  it('maps 0..1 onto 0..dMax, clamped, and rejects a non-positive dMax', () => {
    expect(decodeLogDensity(0, D_MAX)).toBe(0)
    expect(decodeLogDensity(1, D_MAX)).toBeCloseTo(D_MAX, 6)
    expect(decodeLogDensity(-1, D_MAX)).toBe(0)
    expect(decodeLogDensity(2, D_MAX)).toBeCloseTo(D_MAX, 6)
    expect(() => decodeLogDensity(0.5, 0)).toThrow(/dMax/)
  })
})

describe('density raster decoding', () => {
  const data: RasterData = {
    id: 'hyde_population_density',
    frames: [{ t: 0, ref: 'newest.png' }],
    encoding: { channel: 'r', unit: 'people/km2', dMax: 15_000 },
  }

  it("decodes a texel with the raster's own encoding and selects its channel", () => {
    expect(decodeDensityTexel(data, 1)).toBeCloseTo(15_000, 6)
    expect(densityChannelMask('g')).toEqual([0, 1, 0])
  })

  it('throws for a raster without an encoding', () => {
    expect(() => decodeDensityTexel({ id: 'paleodem', frames: [{ t: 0, ref: 'a.png' }] }, 0.5)).toThrow(/encoding/)
  })
})
