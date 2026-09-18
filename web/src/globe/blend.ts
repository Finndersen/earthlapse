/**
 * Pure sampling logic for the globe view (DESIGN §7). No three.js, no React — safe to unit
 * test in plain jsdom/node. `Globe.tsx` is a thin consumer of these functions.
 */

import type { RasterData } from '@/data/curated'
import { sampleRaster } from '@/data/curated'
import type { GeoTime, TimelineEvent } from '@/types/layer'

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

// ------------------------------------------------------------------- multi-source (G7)

/**
 * The globe's two raster sources (docs/GLOBE.md §4.1, ADR-013's "buildLayers.ts... must
 * select raster layers by id once there are several" — now true). `paleodem` covers 0-540 Ma
 * (real data); `neoproterozoic` covers 540-1000 Ma (Merdith et al. 2021 continents, stylised
 * relief) or is `null` when that source is unusable — see `regimeEventsWithRasterFallback`
 * for what the globe shows instead of faking continents in that case.
 */
export interface GlobeRasterLayers {
  paleodem: RasterData
  neoproterozoic: RasterData | null
  /** The Natural Earth II human-era basemap (ADR-030), by tier — `null` when a tier isn't
   *  published (an older manifest). `basemapT0` gates the whole feature: `globeBaseBlendAt`
   *  falls back to plain `globeMultiBlendAt` when it's `null`, regardless of `basemapT1`. */
  basemapT0: RasterData | null
  basemapT1: RasterData | null
  /** HYDE 3.2 population density (ADR-031 amendment), 10,000 BCE - 2015 CE — `null` when the
   *  layer isn't published. Unlike every other entry here it is an *overlay*, not a base: it
   *  carries its own published `encoding` and is composited over whatever base is showing
   *  (`density.ts`). */
  populationDensity: RasterData | null
}

/** 540-550 Ma: PaleoDEM and Merdith don't place continents identically there (docs/GLOBE.md
 *  §4.1), so this band crossfades between them rather than snapping — "do not pretend to
 *  continuity". */
export const SEAM_BAND: readonly [GeoTime, GeoTime] = [540e6, 550e6]

/** How close to `SEAM_BAND`, in years, "approaching it" counts as for preloading the far
 *  side ahead of time (`globeMultiPreloadUrls`) — wider than either source's own frame
 *  spacing (PaleoDEM 5 Myr, Merdith 10 Myr) so a preload window's worth of travel never
 *  crosses the seam blind. */
const SEAM_APPROACH_YEARS = 2e7

/**
 * `globeBlendAt`, generalised across both raster sources (docs/GLOBE.md §4.1): PaleoDEM below
 * `SEAM_BAND`, Merdith above it, and a plain two-texture crossfade of each source's own edge
 * frame (PaleoDEM's 540 Ma, Merdith's 550 Ma) inside the band. Null wherever neither source
 * has data for `t` — including all of `SEAM_BAND` and beyond when `neoproterozoic` is `null`,
 * the caller's cue to fall back to a regime look instead (`regimeEventsWithRasterFallback`).
 */
export function globeMultiBlendAt(layers: GlobeRasterLayers, t: GeoTime, assetBase: string): GlobeBlend | null {
  const { paleodem, neoproterozoic } = layers
  const [seamStart, seamEnd] = SEAM_BAND

  if (t < seamStart) return globeBlendAt(paleodem, t, assetBase)
  if (neoproterozoic === null) return null
  if (t > seamEnd) return globeBlendAt(neoproterozoic, t, assetBase)

  // Inside the seam band: both sources cover their own edge exactly (paleodem's oldest frame
  // is 540 Ma, neoproterozoic's youngest is 540 Ma with a second frame at 550 Ma), so both
  // samples below collapse to a single texture (alpha 0) — a plain two-texture mix of them.
  const before = globeBlendAt(paleodem, seamStart, assetBase)
  const after = globeBlendAt(neoproterozoic, seamEnd, assetBase)
  if (before === null || after === null) return null
  return { beforeUrl: before.beforeUrl, afterUrl: after.beforeUrl, alpha: (t - seamStart) / (seamEnd - seamStart) }
}

/** The two exact edge-frame textures `globeMultiBlendAt` binds as soon as `t` enters
 *  `SEAM_BAND` (PaleoDEM's 540 Ma frame, Merdith's 550 Ma frame) — `[]` when `neoproterozoic`
 *  is `null`. Resolved via `globeBlendAt` at each source's own edge age, where it collapses to
 *  a single texture (`beforeUrl === afterUrl`, `alpha` 0), rather than duplicating the ref
 *  lookup. Exists so `globeMultiPreloadUrls` can warm these two specifically: `globePreloadUrls`
 *  never returns a source's own bracketing frame (by design — that's a load, not a preload),
 *  but here that excluded frame is exactly what the impending seam-band pair needs. */
function seamFrameUrls(layers: GlobeRasterLayers, assetBase: string): string[] {
  if (layers.neoproterozoic === null) return []
  const [seamStart, seamEnd] = SEAM_BAND
  const before = globeBlendAt(layers.paleodem, seamStart, assetBase)
  const after = globeBlendAt(layers.neoproterozoic, seamEnd, assetBase)
  return before === null || after === null ? [] : [before.beforeUrl, after.beforeUrl]
}

/** `globePreloadUrls`, generalised across both raster sources the same way `globeMultiBlendAt`
 *  generalises `globeBlendAt`: delegates to whichever source is active at `t`, and warms
 *  `SEAM_BAND`'s two edge frames (`seamFrameUrls`) when travel is heading towards the band so
 *  crossing it never stalls waiting on a fetch. */
export function globeMultiPreloadUrls(
  layers: GlobeRasterLayers,
  t: GeoTime,
  direction: TravelDirection,
  window: PreloadWindow,
  assetBase: string,
): string[] {
  const { paleodem, neoproterozoic } = layers
  const [seamStart, seamEnd] = SEAM_BAND

  if (t < seamStart) {
    const urls = globePreloadUrls(paleodem, t, direction, window, assetBase)
    if (direction === 'toPast' && seamStart - t <= SEAM_APPROACH_YEARS) {
      urls.push(...seamFrameUrls(layers, assetBase))
    }
    return urls
  }

  if (neoproterozoic === null) return []

  if (t > seamEnd) {
    const urls = globePreloadUrls(neoproterozoic, t, direction, window, assetBase)
    if (direction === 'toPresent' && t - seamEnd <= SEAM_APPROACH_YEARS) {
      urls.push(...seamFrameUrls(layers, assetBase))
    }
    return urls
  }

  // Inside SEAM_BAND itself: globeMultiBlendAt is already showing both edge frames as the
  // bound pair, so preload one step further in the direction of travel.
  return direction === 'toPast'
    ? globePreloadUrls(neoproterozoic, seamEnd, 'toPast', window, assetBase)
    : globePreloadUrls(paleodem, seamStart, 'toPresent', window, assetBase)
}

/** Shown when nothing — no raster source, no regime, no overlay effect — covers `t`. Generic
 *  rather than naming a boundary (the old "before 540 Ma" wording, removed with G7): the only
 *  span this can still apply to is the sliver before any cited regime starts (docs/GLOBE.md
 *  §9 G8), which isn't "before 540 Ma" any more. */
export const NO_RECONSTRUCTION_CAPTION = 'No reconstruction'

const PLATE_MODEL_CAPTION = 'Continents from plate model · relief stylised'
const SEAM_CAPTION = `${PLATE_MODEL_CAPTION} — 540 Ma seam, reconstructions do not align`

/**
 * The fallback caption (docs/GLOBE.md §7) for the raster domain alone — empty over real
 * PaleoDEM data, the seam label across `SEAM_BAND`, the plate-model label over Merdith data,
 * `NO_RECONSTRUCTION_CAPTION` wherever neither source covers `t`. This is a *fallback*: the
 * caller passes it to `resolveGlobeEffects`/`useGlobeEffects` as `fallbackCaption`, which
 * shows it only when no regime or overlay effect (impact winter, ice shell, ...) is active —
 * so the "Snowball Earth" caption still wins over "Continents from plate model" while both
 * are true, exactly as docs/GLOBE.md §4.3 intends.
 */
export function globeMultiCaptionFor(layers: GlobeRasterLayers, t: GeoTime): string {
  const [seamStart, seamEnd] = SEAM_BAND
  if (t < seamStart) return sampleRaster(layers.paleodem, t) !== null ? '' : NO_RECONSTRUCTION_CAPTION
  if (layers.neoproterozoic === null) return NO_RECONSTRUCTION_CAPTION
  if (t <= seamEnd) return SEAM_CAPTION
  return sampleRaster(layers.neoproterozoic, t) !== null ? PLATE_MODEL_CAPTION : NO_RECONSTRUCTION_CAPTION
}

/** Where `neoproterozoic` would otherwise cover the globe (docs/GLOBE.md §4.1). Kept as its
 *  own constant rather than reading `SEAM_BAND` (a different, narrower concern: the crossfade
 *  band at the *edge* of this domain, not the domain itself). */
const NEOPROTEROZOIC_DOMAIN: readonly [GeoTime, GeoTime] = [540e6, 1000e6]

// ------------------------------------------------------------------- human-era base (ADR-030)

/**
 * Years BP over which the globe's base crosses from PaleoDEM's 0 Ma frame to the human-era
 * basemap (Natural Earth II, `sources/basemap`) — `[nearEdge, farEdge]`, same `[younger, older]`
 * convention as `SEAM_BAND`. Fixed directly by the user (ADR-030), a narrower span than the wider
 * 90/80 ka recommendation an earlier design proposal made, which covered a broader scope than
 * this feature builds (ice/sea level/dispersal overlays). Not manifest data, for the same reason
 * `SEAM_BAND` isn't: a raster crossfade boundary the web side alone owns.
 */
export const BASEMAP_CROSSFADE_BAND: readonly [GeoTime, GeoTime] = [300_000, 400_000]

/**
 * The basemap's crossfade weight at `t` (ADR-030): 0 at and above
 * `BASEMAP_CROSSFADE_BAND`'s far edge (400 ka — "before 400 ka behaviour unchanged"), 1 at and
 * below its near edge (300 ka — pure basemap), linear between. This is deliberately *not*
 * folded into `GlobeBlend`/the existing `uBefore`/`uAfter`/`uMix` uniforms the way `SEAM_BAND`'s
 * crossfade is: the basemap is a single, time-invariant texture per tier (not a sequence of
 * dated frames to bracket), so it gets its own uniform slot (`Globe.tsx`'s `uBasemapTex`/
 * `uBasemapStrength`) mixed *over* the ordinary PaleoDEM `dataColor` in the shader, rather than
 * reusing that slot for two different kinds of thing. This also keeps the two textures on their
 * own caches (`textureCache.ts` for PaleoDEM, `humanEraTextureCache.ts`'s mipmapped instance for
 * the basemap) without needing one `GlobeTexturePair` to somehow serve both.
 */
export function basemapStrengthAt(t: GeoTime): number {
  const [nearEdge, farEdge] = BASEMAP_CROSSFADE_BAND
  if (t >= farEdge) return 0
  if (t <= nearEdge) return 1
  return (farEdge - t) / (farEdge - nearEdge)
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/**
 * Tone-match grade for the Natural Earth II basemap (ADR-030 amendment, user report 2026-09-17:
 * "significantly lighter than the previous texture and appears over-exposed... washed-out pale
 * land and pale blue oceans"). **Not a colour-space bug** — checked directly: both the PaleoDEM
 * and basemap textures set `texture.colorSpace = THREE.SRGBColorSpace` identically
 * (`textureCache.ts`, `humanEraTextureCache.ts`), both decode via a plain `createImageBitmap`
 * with no extra options, `GLOBE_FRAGMENT_SHADER` ends with the same `#include <colorspace_fragment>`
 * for both, and sampling the *rendered* globe against the *source* `basemap_t0.webp` file at four
 * points (mid-Atlantic, Sahara, Amazon, Himalaya, `scratchpad/globe-fixes-notes.md`) matched within
 * a few percent at every one — the render is a faithful reproduction of the source file. The
 * mismatch is real but sits one level up: Natural Earth II's own photographic palette is simply
 * far paler and less saturated than PaleoDEM's stylised hypsometric tint, so swapping one for the
 * other at `BASEMAP_CROSSFADE_BAND` reads as a brightness jump even though neither is rendered
 * wrong. Measured side by side (reduced-motion, same camera, same regions) at 434.8 ka (PaleoDEM,
 * just outside the crossfade band) vs 216.8 ka (basemap, fully crossfaded in):
 *
 * | region | PaleoDEM relative luminance | basemap relative luminance (ungraded) |
 * |---|---|---|
 * | mid-Atlantic / South Atlantic ocean | ~0.03 | ~0.26 (~9x brighter) |
 * | Sahel/Sahara land | 0.25 (stylised green) | 0.86 (blown-out pale sand) |
 * | Amazon land | 0.17 (stylised green) | 0.36 (~2x brighter, desaturated) |
 *
 * `gradeBasemapColor` is a plain levels/gamma/saturation grade applied to the basemap texture's
 * own colour only (never PaleoDEM's, never a regime look) — `BASEMAP_GRADE_SCALE` pulls the output
 * ceiling down so even a blown-out highlight (bright sand, cloud) can't reach display white,
 * `BASEMAP_GRADE_GAMMA` (`> 1`) darkens the midtones a `scale`-only correction wouldn't reach, and
 * `BASEMAP_GRADE_SATURATION` (`> 1`) restores the saturation the darkening alone would otherwise
 * leave looking flat. Tuned against the measurements above (`blend.test.ts` pins the ocean sample
 * landing close to PaleoDEM's own dark, saturated blue) rather than a global "looks nice" guess;
 * land does not attempt to chase PaleoDEM's own arbitrary green hypsometric tint — a real desert
 * should still read as sand-coloured, just not blown out to near-white.
 */
export const BASEMAP_GRADE_SCALE = 0.6
export const BASEMAP_GRADE_GAMMA = 1.7
export const BASEMAP_GRADE_SATURATION = 1.2

function basemapGradeChannel(c: number): number {
  return BASEMAP_GRADE_SCALE * Math.pow(clamp01(c), BASEMAP_GRADE_GAMMA)
}

/** `GLOBE_FRAGMENT_SHADER`'s own basemap grade (`shaders.ts`), as a pure TS function — the GLSL
 *  applies this exact formula per-fragment on the GPU; this is that formula, callable from a
 *  plain unit test instead. Takes and returns a `[r, g, b]` triple in 0..1. */
export function gradeBasemapColor([r, g, b]: readonly [number, number, number]): readonly [number, number, number] {
  const gr = basemapGradeChannel(r)
  const gg = basemapGradeChannel(g)
  const gb = basemapGradeChannel(b)
  const luminance = 0.2126 * gr + 0.7152 * gg + 0.0722 * gb
  return [
    clamp01(luminance + (gr - luminance) * BASEMAP_GRADE_SATURATION),
    clamp01(luminance + (gg - luminance) * BASEMAP_GRADE_SATURATION),
    clamp01(luminance + (gb - luminance) * BASEMAP_GRADE_SATURATION),
  ]
}

/**
 * docs/GLOBE.md G7's fallback rule: if the Merdith source is unusable (`neoproterozoicAvailable
 * = false`), the globe must not fake continents for 540-1000 Ma — it shows the same
 * "geography unknown" regime look that already covers 1000 Ma and older instead. Additive: this
 * appends one synthetic regime event rather than editing `globe-regimes`' own hand-curated,
 * citation-backed data (§4.2's regimes are all literature-dated; "the build failed" is not a
 * citation) — `regimeWeightsAt` (`effects/regimes.ts`) treats it like any other regime event, so
 * it crossfades against its neighbours (`proterozoic-unknown-geography-regime`, right next to
 * it at 1000 Ma) the normal way.
 */
export function regimeEventsWithRasterFallback(
  regimeEvents: readonly TimelineEvent[],
  neoproterozoicAvailable: boolean,
): readonly TimelineEvent[] {
  if (neoproterozoicAvailable) return regimeEvents
  const [tMin, tMax] = NEOPROTEROZOIC_DOMAIN
  const fallback: TimelineEvent = {
    id: 'plates-neoproterozoic-unavailable-regime',
    label: 'Geography unknown (continents unavailable)',
    tMin,
    tMax,
    importance: 0.5,
    description:
      'The Merdith et al. 2021 continental reconstruction could not be built for this span. ' +
      'Rather than fake continents, it shows the same "geography unknown" look used before ' +
      '1 Ga (docs/GLOBE.md §4.1 G7 fallback rule).',
    citation: 'docs/GLOBE.md §4.1 (G7) fallback rule — not a literature date.',
    effect: { kind: 'regime-unknown-geography', windows: [{ tMin, tMax }] },
  }
  return [...regimeEvents, fallback]
}
