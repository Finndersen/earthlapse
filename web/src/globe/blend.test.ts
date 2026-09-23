import { describe, expect, it } from 'vitest'

import type { RasterData } from '@/data/curated'
import type { TimelineEvent } from '@/types/layer'

import {
  BASEMAP_CROSSFADE_BAND,
  BASEMAP_GRADE_SCALE,
  basemapStrengthAt,
  globeBlendAt,
  globeMultiBlendAt,
  globeMultiCaptionFor,
  globeMultiPreloadUrls,
  globePreloadUrls,
  globeUniforms,
  gradeBasemapColor,
  NO_RECONSTRUCTION_CAPTION,
  regimeEventsWithRasterFallback,
  SEAM_BAND,
  travelDirection,
  type GlobeRasterLayers,
} from './blend'

const assetBase = 'https://cdn.example.com/assets'
const pd = (ma: number) => `${assetBase}/textures/paleodem/${String(ma).padStart(3, '0')}Ma.png`

const frames: RasterData = {
  id: 'paleodem',
  frames: [0, 100, 200, 540].map((ma) => ({ t: ma * 1e6, ref: `textures/paleodem/${String(ma).padStart(3, '0')}Ma.png` })),
}

const neoproterozoicFrames: RasterData = {
  id: 'plates_neoproterozoic',
  frames: [540, 550, 560, 980, 990, 1000].map((ma) => ({ t: ma * 1e6, ref: `textures/plates_neoproterozoic/${ma}Ma.webp` })),
}

const layers: GlobeRasterLayers = {
  paleodem: frames,
  neoproterozoic: neoproterozoicFrames,
  basemapT0: null,
  basemapT1: null,
  overlayRasters: new Map(),
}
const layersUnusable: GlobeRasterLayers = { ...layers, neoproterozoic: null }

describe('globeBlendAt', () => {
  it('blends the bracketing pair, collapsing to one texture on an exact frame', () => {
    expect(globeBlendAt(frames, 50e6, assetBase)).toEqual({ beforeUrl: pd(0), afterUrl: pd(100), alpha: 0.5 })
    expect(globeBlendAt(frames, 195e6, assetBase)).toEqual({ beforeUrl: pd(100), afterUrl: pd(200), alpha: 0.95 })
    expect(globeBlendAt(frames, 540e6, assetBase)).toEqual({ beforeUrl: pd(540), afterUrl: pd(540), alpha: 0 })
  })

  it('is null outside the domain and tolerant of a trailing slash on the base', () => {
    expect(globeBlendAt(frames, 600e6, assetBase)).toBeNull()
    expect(globeBlendAt(frames, -1, assetBase)).toBeNull()
    expect(globeBlendAt(frames, 0, `${assetBase}/`)).toEqual(globeBlendAt(frames, 0, assetBase))
  })

  it('maps to shader uniforms', () => {
    expect(globeUniforms(globeBlendAt(frames, 195e6, assetBase))).toEqual({ mix: 0.95, hasData: true })
    expect(globeUniforms(null)).toEqual({ mix: 0, hasData: false })
  })
})

describe('travelDirection', () => {
  it('follows the sign of the t change, holding when unchanged', () => {
    expect(travelDirection(100e6, 101e6, 'toPresent')).toBe('toPast')
    expect(travelDirection(101e6, 100e6, 'toPast')).toBe('toPresent')
    expect(travelDirection(100e6, 100e6, 'toPast')).toBe('toPast')
  })
})

describe('globePreloadUrls', () => {
  const dense: RasterData = { id: 'paleodem', frames: [0, 5, 10, 15, 20, 25, 30].map((ma) => ({ t: ma * 1e6, ref: `f/${ma}.webp` })) }
  const url = (ma: number) => `${assetBase}/f/${ma}.webp`

  it('warms frames beyond the bracketing pair ahead (nearest first), then behind', () => {
    expect(globePreloadUrls(dense, 17e6, 'toPresent', { ahead: 2, behind: 1 }, assetBase)).toEqual([url(10), url(5), url(25)])
    expect(globePreloadUrls(dense, 12e6, 'toPast', { ahead: 2, behind: 1 }, assetBase)).toEqual([url(20), url(25), url(5)])
    expect(globePreloadUrls(dense, 15e6, 'toPresent', { ahead: 1, behind: 1 }, assetBase)).toEqual([url(10), url(20)])
  })

  it('stops at the sequence ends and is empty outside the domain', () => {
    expect(globePreloadUrls(dense, 2e6, 'toPresent', { ahead: 3, behind: 2 }, assetBase)).toEqual([url(10), url(15)])
    expect(globePreloadUrls(dense, 31e6, 'toPresent', { ahead: 3, behind: 1 }, assetBase)).toEqual([])
  })
})

describe('multi-source globe', () => {
  it('delegates to the source covering t on either side of the seam', () => {
    expect(globeMultiBlendAt(layers, 100e6, assetBase)).toEqual(globeBlendAt(frames, 100e6, assetBase))
    expect(globeMultiBlendAt(layers, 700e6, assetBase)).toEqual(globeBlendAt(neoproterozoicFrames, 700e6, assetBase))
    expect(globeMultiBlendAt(layersUnusable, 100e6, assetBase)).toEqual(globeBlendAt(frames, 100e6, assetBase))
  })

  it('crossfades across the seam band between the two edge frames', () => {
    const [start, end] = SEAM_BAND
    const edges = { beforeUrl: pd(540), afterUrl: `${assetBase}/textures/plates_neoproterozoic/550Ma.webp` }
    expect(globeMultiBlendAt(layers, start, assetBase)).toEqual({ ...edges, alpha: 0 })
    expect(globeMultiBlendAt(layers, (start + end) / 2, assetBase)).toEqual({ ...edges, alpha: 0.5 })
    expect(globeMultiBlendAt(layers, end, assetBase)).toEqual({ ...edges, alpha: 1 })
  })

  it('has no data past paleodem when neoproterozoic is unusable', () => {
    expect(globeMultiBlendAt(layersUnusable, 545e6, assetBase)).toBeNull()
    expect(globeMultiPreloadUrls(layersUnusable, 700e6, 'toPast', { ahead: 2, behind: 1 }, assetBase)).toEqual([])
    expect(globeMultiCaptionFor(layersUnusable, 700e6)).toBe(NO_RECONSTRUCTION_CAPTION)
  })

  it.each([
    [530e6, 'toPast'],
    [560e6, 'toPresent'],
  ] as const)('warms both seam edge frames approaching from %s', (t, direction) => {
    const urls = globeMultiPreloadUrls(layers, t, direction, { ahead: 2, behind: 1 }, assetBase)
    expect(urls).toContain(pd(540))
    expect(urls).toContain(`${assetBase}/textures/plates_neoproterozoic/550Ma.webp`)
    expect(globeMultiPreloadUrls(layers, 0, 'toPast', { ahead: 2, behind: 1 }, assetBase).some((u) => u.includes('neoproterozoic'))).toBe(false)
  })

  it('captions only where the texture is not plain paleodem', () => {
    expect(globeMultiCaptionFor(layers, 0)).toBe('')
    expect(globeMultiCaptionFor(layers, 545e6)).not.toBe('')
    expect(globeMultiCaptionFor(layers, 700e6)).not.toBe('')
    expect(globeMultiCaptionFor(layers, 1.1e9)).toBe(NO_RECONSTRUCTION_CAPTION)
  })

  it('adds a geography-unknown regime over 540–1000 Ma only when neoproterozoic is missing', () => {
    const events: TimelineEvent[] = [
      {
        id: 'proterozoic',
        label: 'P',
        tMin: 1.0e9,
        tMax: 2.4e9,
        importance: 0.5,
        description: 'd',
        citation: 'c',
        effect: { kind: 'regime-unknown-geography', windows: [{ tMin: 1.0e9, tMax: 2.4e9 }] },
      },
    ]
    expect(regimeEventsWithRasterFallback(events, true)).toBe(events)
    const result = regimeEventsWithRasterFallback(events, false)
    expect(result[1]!.effect).toEqual({ kind: 'regime-unknown-geography', windows: [{ tMin: 540e6, tMax: 1000e6 }] })
  })
})

describe('basemap', () => {
  it('ramps strength from 0 beyond the band to 1 inside it', () => {
    const [near, far] = BASEMAP_CROSSFADE_BAND
    expect(basemapStrengthAt(far)).toBe(0)
    expect(basemapStrengthAt(100e6)).toBe(0)
    expect(basemapStrengthAt((near + far) / 2)).toBeCloseTo(0.5)
    expect(basemapStrengthAt(near)).toBe(1)
    expect(basemapStrengthAt(0)).toBe(1)
  })

  it('grades colour into [0, BASEMAP_GRADE_SCALE], keeping grey neutral and blue ocean blue', () => {
    expect(gradeBasemapColor([0, 0, 0])).toEqual([0, 0, 0])
    gradeBasemapColor([1, 1, 1]).forEach((v) => expect(v).toBeCloseTo(BASEMAP_GRADE_SCALE, 6))
    const [gr, gg, gb] = gradeBasemapColor([0.5, 0.5, 0.5])
    expect(gr).toBeCloseTo(gg, 10)
    expect(gg).toBeCloseTo(gb, 10)
    const [r, g, b] = gradeBasemapColor([99 / 255, 152 / 255, 190 / 255])
    expect(b).toBeGreaterThan(Math.max(r, g))
    for (const input of [
      [-0.5, 2, 0.5],
      [1.5, -1, 0.5],
    ] as const) {
      for (const v of gradeBasemapColor(input)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })
})
