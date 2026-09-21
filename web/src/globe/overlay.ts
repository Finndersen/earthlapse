/**
 * The closed registry of raster overlays that may occupy the globe's single overlay slot — the
 * one place the set of overlays is enumerated, read by both the selector control and Globe.tsx.
 */

import type { RasterData } from '@/data/curated'
import type { GeoTime } from '@/types/layer'

import { globeBlendAt, type GlobeBlend } from './blend'
import { CLEARED_LAND_SWATCH_HEX, CLEARED_LAND_WEIGHTS } from './clearedLand'
import { DENSITY_SWATCH_HEX } from './density'
import { clamp01 } from './effects/math'

export type GlobeOverlayKind = 'population_density' | 'cleared_land'

/**
 * How a kind's texel bytes become the ramp's input scalar. `log_encoded` carries no weights of
 * its own: the channel mask is only knowable at runtime from the layer's published
 * `encoding.channel` (`densityChannelMask` in `density.ts`), so the spec here must not hardcode
 * it. `linear_fraction` carries its weights directly since there is no published encoding to
 * read them from (`clearedLand.ts`'s `CLEARED_LAND_WEIGHTS`).
 */
export type OverlaySampling =
  | { readonly mode: 'log_encoded' }
  | { readonly mode: 'linear_fraction'; readonly weights: readonly [number, number, number] }

export interface GlobeOverlaySpec {
  kind: GlobeOverlayKind
  /** The published manifest layer id this overlay reads. */
  layerId: string
  /** Selector control label. */
  label: string
  sampling: OverlaySampling
  /** One representative colour for a selector swatch, drawn from the kind's own ramp so it
   *  cannot drift from what the globe paints. */
  swatchHex: string
}

export const GLOBE_OVERLAYS: Readonly<Record<GlobeOverlayKind, GlobeOverlaySpec>> = {
  population_density: {
    kind: 'population_density',
    layerId: 'hyde_population_density',
    label: 'Population density',
    sampling: { mode: 'log_encoded' },
    swatchHex: DENSITY_SWATCH_HEX,
  },
  cleared_land: {
    kind: 'cleared_land',
    layerId: 'hyde_cleared_land',
    label: 'Cleared land',
    sampling: { mode: 'linear_fraction', weights: CLEARED_LAND_WEIGHTS },
    swatchHex: CLEARED_LAND_SWATCH_HEX,
  },
}

/** Stable display order for the selector — population density first, it is the existing
 *  default. */
export const GLOBE_OVERLAY_KINDS: readonly GlobeOverlayKind[] = ['population_density', 'cleared_land']

/**
 * The shader's overlay discriminator, as an exhaustive map rather than a ternary so adding a kind
 * is a type error here instead of silently aliasing onto an existing one. Zero must stay
 * population density: WebGL zero-inits uniforms, so an unset uniform reproduces today's
 * single-overlay behaviour exactly rather than switching overlay under a caller that set none.
 */
const OVERLAY_KIND_UNIFORMS: Readonly<Record<GlobeOverlayKind, number>> = {
  population_density: 0,
  cleared_land: 1,
}

export function overlayKindUniform(kind: GlobeOverlayKind): number {
  return OVERLAY_KIND_UNIFORMS[kind]
}

// ------------------------------------------------------------------------ domain and binding

/**
 * How far past a raster overlay's own oldest frame (10,000 BCE for both published overlays) the
 * wash eases in from nothing, rather than popping in at a hard edge as the arrival arcs finish.
 *
 * Deliberately a real year count, not a warp width: this band sits entirely inside the Holocene,
 * where the symlog axis is close to linear anyway, and it is anchored to a *data* edge rather
 * than to playback. What it shows across the band is the oldest frame itself, eased in — for
 * population density, at 10,000 BCE HYDE models roughly four million people worldwide, so every
 * texel in the band is at or near the ramp's own floor and the overlay is, correctly, almost
 * nothing to see.
 */
export const OVERLAY_FADE_BAND_YEARS = 2_500

/**
 * An overlay's own weight at `t`: 1 at and below the sequence's oldest frame, easing to 0 across
 * `OVERLAY_FADE_BAND_YEARS` older than it, and 0 beyond. Never fades *out* toward the present —
 * both published overlays' HYDE 3.2 domain ends at 2015 CE and `overlayBlendAt` holds that frame,
 * the same "data ends, held after" rule ADR-031 established.
 */
export function overlayStrengthAt(data: RasterData, t: GeoTime): number {
  const oldest = data.frames[data.frames.length - 1]!.t
  if (t <= oldest) return 1
  return clamp01((oldest + OVERLAY_FADE_BAND_YEARS - t) / OVERLAY_FADE_BAND_YEARS)
}

/**
 * The two frames to bind at `t`, clamped to the sequence's own domain at both ends: the newest
 * frame is held from 2015 CE to the present (the data simply ends), and the oldest frame is what
 * the fade-in band above shows. `null` only once `t` is past the band entirely, which is also
 * exactly when `overlayStrengthAt` is 0 — so nothing is ever fetched for a `t` that would not
 * draw it.
 */
export function overlayBlendAt(data: RasterData, t: GeoTime, assetBase: string): GlobeBlend | null {
  if (overlayStrengthAt(data, t) <= 0) return null
  const newest = data.frames[0]!.t
  const oldest = data.frames[data.frames.length - 1]!.t
  return globeBlendAt(data, Math.min(oldest, Math.max(newest, t)), assetBase)
}

/** Whether an overlay has anything to draw at `t` — the "Human civilisation" legend row used to
 *  read this alongside the arrivals' and cities' own equivalents before the overlay slot became a
 *  selector independent of that toggle (ADR-041 item 7). */
export function overlayHasDataAt(data: RasterData | null, t: GeoTime): boolean {
  return data !== null && overlayStrengthAt(data, t) > 0
}
