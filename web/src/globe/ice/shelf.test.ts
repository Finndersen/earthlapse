import { describe, expect, it } from 'vitest'

import { PALEODEM_LAND_STOPS, PALEODEM_SEA_STOPS, paleodemSeaDepthFromRed, SHELF_GLSL, WATER_BLUE_OVER_GREEN } from './shelf'

describe('paleodemSeaDepthFromRed', () => {
  it('inverts every palette stop exactly', () => {
    for (const [z, [red]] of PALEODEM_SEA_STOPS) expect(paleodemSeaDepthFromRed(red)).toBe(z)
  })

  it('interpolates between stops, as the palette does', () => {
    expect(paleodemSeaDepthFromRed(85)).toBe(-100)
    expect(paleodemSeaDepthFromRed(45)).toBe(-600)
  })

  it('clamps outside the palette', () => {
    expect(paleodemSeaDepthFromRed(0)).toBe(-11000)
    expect(paleodemSeaDepthFromRed(200)).toBe(0)
  })

  it('reads published 0 Ma shelf texels to within the claimed ~15 m', () => {
    // sRGB red sampled from textures/paleodem/000.0Ma.webp beside the raw PaleoDEM depth there.
    const samples: readonly [number, number][] = [
      [98, -40],
      [93, -80],
      [78, -120],
    ]
    for (const [red, depth] of samples) expect(Math.abs(paleodemSeaDepthFromRed(red) - depth)).toBeLessThanOrEqual(15)
  })
})

describe('water detection threshold', () => {
  it('separates every sea stop from every land colour of the palette', () => {
    for (const [, [, g, b]] of PALEODEM_SEA_STOPS) expect(b - g).toBeGreaterThan(WATER_BLUE_OVER_GREEN[1])
    for (const [, [, g, b]] of PALEODEM_LAND_STOPS) expect(b - g).toBeLessThan(WATER_BLUE_OVER_GREEN[0])
  })
})

describe('SHELF_GLSL', () => {
  it('generates one depth segment per pair of palette stops', () => {
    expect(SHELF_GLSL.match(/if \(red <= [^)]*\) return mix\(/g)).toHaveLength(PALEODEM_SEA_STOPS.length - 1)
  })
})
