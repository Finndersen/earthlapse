import { describe, expect, it } from 'vitest'

import type { RasterData } from '@/data/curated'

import { globeBlendAt, globePreloadUrls, globeUniforms, travelDirection } from './blend'

const assetBase = 'https://cdn.example.com/assets'

// Frames at 0, 100 Ma, 200 Ma, 540 Ma, as specified for W8.
const frames: RasterData = {
  id: 'paleodem',
  frames: [
    { t: 0, ref: 'textures/paleodem/000Ma.png' },
    { t: 100e6, ref: 'textures/paleodem/100Ma.png' },
    { t: 200e6, ref: 'textures/paleodem/200Ma.png' },
    { t: 540e6, ref: 'textures/paleodem/540Ma.png' },
  ],
}

describe('globeBlendAt', () => {
  it('collapses to a single texture with alpha 0 on an exact interior frame', () => {
    const blend = globeBlendAt(frames, 100e6, assetBase)
    expect(blend).toEqual({
      beforeUrl: 'https://cdn.example.com/assets/textures/paleodem/100Ma.png',
      afterUrl: 'https://cdn.example.com/assets/textures/paleodem/100Ma.png',
      alpha: 0,
    })
  })

  it('blends the bracketing pair at a midpoint', () => {
    const blend = globeBlendAt(frames, 50e6, assetBase)
    expect(blend).toEqual({
      beforeUrl: 'https://cdn.example.com/assets/textures/paleodem/000Ma.png',
      afterUrl: 'https://cdn.example.com/assets/textures/paleodem/100Ma.png',
      alpha: 0.5,
    })
  })

  it('blends the bracketing pair near a frame boundary', () => {
    const blend = globeBlendAt(frames, 195e6, assetBase)
    expect(blend).toEqual({
      beforeUrl: 'https://cdn.example.com/assets/textures/paleodem/100Ma.png',
      afterUrl: 'https://cdn.example.com/assets/textures/paleodem/200Ma.png',
      alpha: 0.95,
    })
  })

  it('collapses to a single texture at the oldest frame, the edge of the domain', () => {
    const blend = globeBlendAt(frames, 540e6, assetBase)
    expect(blend).toEqual({
      beforeUrl: 'https://cdn.example.com/assets/textures/paleodem/540Ma.png',
      afterUrl: 'https://cdn.example.com/assets/textures/paleodem/540Ma.png',
      alpha: 0,
    })
  })

  it('is null beyond the domain — older than the oldest frame', () => {
    expect(globeBlendAt(frames, 600e6, assetBase)).toBeNull()
  })

  it('is null beyond the domain — newer than the newest frame', () => {
    expect(globeBlendAt(frames, -1, assetBase)).toBeNull()
  })

  it('resolves refs against an assetBase without a trailing slash the same as with one', () => {
    const withSlash = globeBlendAt(frames, 0, 'https://cdn.example.com/assets/')
    const withoutSlash = globeBlendAt(frames, 0, 'https://cdn.example.com/assets')
    expect(withSlash).toEqual(withoutSlash)
  })
})

describe('globeUniforms', () => {
  it('reports hasData and the blend alpha as mix when inside the domain', () => {
    const blend = globeBlendAt(frames, 195e6, assetBase)
    expect(globeUniforms(blend)).toEqual({ mix: 0.95, hasData: true })
  })

  it('reports no data and a zero mix when the blend is null', () => {
    expect(globeUniforms(null)).toEqual({ mix: 0, hasData: false })
  })
})

describe('travelDirection', () => {
  it('is toPast when t grows (years before present)', () => {
    expect(travelDirection(100e6, 101e6, 'toPresent')).toBe('toPast')
  })

  it('is toPresent when t shrinks', () => {
    expect(travelDirection(101e6, 100e6, 'toPast')).toBe('toPresent')
  })

  it('keeps the previous direction when t is unchanged', () => {
    expect(travelDirection(100e6, 100e6, 'toPast')).toBe('toPast')
    expect(travelDirection(100e6, 100e6, 'toPresent')).toBe('toPresent')
  })
})

describe('globePreloadUrls', () => {
  // Seven frames 5 Myr apart, 0..30 Ma.
  const dense: RasterData = {
    id: 'paleodem',
    frames: [0, 5, 10, 15, 20, 25, 30].map((ma) => ({ t: ma * 1e6, ref: `f/${ma}.webp` })),
  }
  const url = (ma: number) => `${assetBase}/f/${ma}.webp`

  it('warms frames beyond the bracketing pair towards the present, nearest first, then behind', () => {
    const urls = globePreloadUrls(dense, 17e6, 'toPresent', { ahead: 2, behind: 1 }, assetBase)
    expect(urls).toEqual([url(10), url(5), url(25)])
  })

  it('warms frames beyond the bracketing pair towards the past, nearest first, then behind', () => {
    const urls = globePreloadUrls(dense, 12e6, 'toPast', { ahead: 2, behind: 1 }, assetBase)
    expect(urls).toEqual([url(20), url(25), url(5)])
  })

  it('treats an exact frame as its own pair and warms its neighbours', () => {
    const urls = globePreloadUrls(dense, 15e6, 'toPresent', { ahead: 1, behind: 1 }, assetBase)
    expect(urls).toEqual([url(10), url(20)])
  })

  it('stops at the ends of the sequence instead of wrapping or padding', () => {
    expect(globePreloadUrls(dense, 2e6, 'toPresent', { ahead: 3, behind: 2 }, assetBase)).toEqual([url(10), url(15)])
    expect(globePreloadUrls(dense, 30e6, 'toPast', { ahead: 3, behind: 1 }, assetBase)).toEqual([url(25)])
  })

  it('is empty outside the domain', () => {
    expect(globePreloadUrls(dense, 31e6, 'toPresent', { ahead: 3, behind: 1 }, assetBase)).toEqual([])
    expect(globePreloadUrls(dense, -1, 'toPast', { ahead: 3, behind: 1 }, assetBase)).toEqual([])
  })
})
