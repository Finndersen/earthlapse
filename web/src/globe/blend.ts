/**
 * Pure sampling logic for the globe view (DESIGN §7). No three.js, no React — safe to unit
 * test in plain jsdom/node. `Globe.tsx` is a thin consumer of these two functions.
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
