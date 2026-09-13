/**
 * Pure sampling logic for the globe view (DESIGN §7). No three.js, no React — safe to unit
 * test in plain jsdom/node. `Globe.tsx` is a thin consumer of these functions.
 */

import type { RasterData } from '@/data/curated'
import { sampleRaster } from '@/data/curated'
import type { GeoTime } from '@/types/layer'

/** The two equirectangular textures the globe should currently be blending, resolved to
 *  fetchable URLs against `assetBase`, plus the mix factor between them. */
export interface GlobeBlend {
  beforeUrl: string
  afterUrl: string
  /** 0 -> beforeUrl, 1 -> afterUrl. */
  alpha: number
}

/** Joins a manifest-relative ref onto `assetBase`, tolerating either side's slashes. Refs are
 *  always relative (DATA_SOURCES contract); `assetBase` may be a local dev path or a CDN URL. */
function resolveAssetRef(assetBase: string, ref: string): string {
  const base = assetBase.endsWith('/') ? assetBase.slice(0, -1) : assetBase
  const rel = ref.startsWith('/') ? ref.slice(1) : ref
  return `${base}/${rel}`
}

/**
 * A thin wrapper over `sampleRaster`: resolves the sampled before/after refs against
 * `assetBase`. Null outside the raster's time domain (older than the oldest frame, or newer
 * than the newest) — the caller renders a neutral globe rather than fabricating data.
 */
export function globeBlendAt(data: RasterData, t: GeoTime, assetBase: string): GlobeBlend | null {
  const raster = sampleRaster(data, t)
  if (raster === null) return null
  return {
    beforeUrl: resolveAssetRef(assetBase, raster.before),
    afterUrl: resolveAssetRef(assetBase, raster.after),
    alpha: raster.alpha,
  }
}

/** Shader uniform values derived from a blend. `hasData` gates the shader between the
 *  textured sphere and the neutral out-of-domain look; `mix` is meaningless when it's false. */
export interface GlobeUniformValues {
  mix: number
  hasData: boolean
}

export function globeUniforms(blend: GlobeBlend | null): GlobeUniformValues {
  if (blend === null) return { mix: 0, hasData: false }
  return { mix: blend.alpha, hasData: true }
}

// ----------------------------------------------------------------------------- preloading

/** Which way `t` last moved. `t` is years before present, so a growing `t` travels into the
 *  past. */
export type TravelDirection = 'toPast' | 'toPresent'

/** Sticky: an unchanged `t` keeps the previous direction, so pausing playback doesn't
 *  forget which frames are about to be needed. */
export function travelDirection(previousT: GeoTime, t: GeoTime, previous: TravelDirection): TravelDirection {
  if (t > previousT) return 'toPast'
  if (t < previousT) return 'toPresent'
  return previous
}

/** How many frames beyond the bracketing pair to warm in the direction of travel, and
 *  behind it (a small reversal while scrubbing shouldn't wait on the network either). */
export interface PreloadWindow {
  ahead: number
  behind: number
}

/**
 * The frames worth fetching before they are needed: `window.ahead` frames past the bracketing
 * pair in the direction of travel, and `window.behind` on the other side. Excludes the pair
 * itself (that is a load, not a preload). Empty outside the domain.
 *
 * Frames are sorted ascending by `t` (`parseRasterData` guarantees it), so "toPast" walks
 * towards higher indices.
 */
export function globePreloadUrls(
  data: RasterData,
  t: GeoTime,
  direction: TravelDirection,
  window: PreloadWindow,
  assetBase: string,
): string[] {
  const { frames } = data
  if (t < frames[0]!.t || t > frames[frames.length - 1]!.t) return []

  const upper = frames.findIndex((f) => f.t >= t)
  const lower = frames[upper]!.t === t ? upper : upper - 1
  const pastCount = direction === 'toPast' ? window.ahead : window.behind
  const presentCount = direction === 'toPast' ? window.behind : window.ahead

  const past = frames.slice(upper + 1, upper + 1 + pastCount)
  const present = frames.slice(Math.max(0, lower - presentCount), lower).reverse()
  const ahead = direction === 'toPast' ? past : present
  const behind = direction === 'toPast' ? present : past
  return [...ahead, ...behind].map((f) => resolveAssetRef(assetBase, f.ref))
}
