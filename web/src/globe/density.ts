/**
 * The population-density overlay's pure core (ADR-031 amendment): how a published
 * `hyde_population_density` texel decodes to real people per km², what colour that density
 * reads as, when the overlay fades in, and which frames to bind. No three.js, no React — the
 * same pure-core split `blend.ts` and `arcs.ts` follow.
 *
 * **Decoded honestly, then mapped.** The published texture is a single 8-bit channel holding
 * `round(255 · log10(1 + d) / log10(1 + dMax))` (`pipeline/density_encoding.py`, `dMax = 15,000`
 * people/km²). Nothing here treats that byte as a colour: `decodeLogDensity` (`@/data/curated`,
 * the TS twin of the pipeline's own decoder) turns it back into people/km² first, and
 * `densityRampAt` is defined on *that* quantity, with its stops written in real units. The
 * legend key under the toggle (`DensityRampKey.tsx`) is generated from the same stops, so what
 * the globe paints and what the key claims cannot drift.
 *
 * **Why this ramp.** The overlay it replaces (HYDE cleared land, ADR-031) was rejected for being
 * too subtle to see. It failed for two compounding reasons: a *linear* fraction spread thinly
 * across a huge range, and earthy ochre/olive tints that sit inside the same hue family as the
 * terrain underneath. This ramp fixes both. The quantity is log-spaced by construction (one ramp
 * stop per rough order of magnitude, from 2 to 8,000 people/km²), and the hues run dark violet →
 * magenta → hot pink → near-white: a family with no counterpart in Natural Earth II's greens,
 * tans and blues (nor in this layer's own arrivals amber or cities cyan — `humanStyle.ts`'s own
 * doc comment), so even the faintest inhabited band reads as an artificial overlay rather than as
 * terrain (2026-09 user feedback: an earlier violet→amber ramp "looks a bit like an 'earthy'
 * colour"). Lightness rises monotonically from the first stop to the last, so the ramp still
 * reads as a sensible scale in greyscale or at low alpha, not just in colour. Alpha climbs with
 * density too, so an empty ocean or desert shows the basemap untouched while a city core is
 * nearly opaque.
 *
 * **Mip strategy.** The overlay's texture cache uses `'boxFilter'` mips and `NoColorSpace`
 * (`humanEraTextureCache.ts`), for the reason that module's own doc comment gives: these bytes
 * are numeric, not gamma-encoded colour. The lesson that motivated it there (HYDE's sharp
 * Sahel-fringe boundaries aliasing into a saturated band at orb size without mips) applies
 * unchanged here — population density is spatially even sharper, a city core sitting beside an
 * empty hinterland. One honest caveat follows from box-filtering *encoded* bytes: averaging the
 * log is a geometric mean, so a minified texel reads a little *below* the true area average
 * rather than above it. That errs toward under-claiming, which is the right direction for an
 * overlay whose whole failure mode in ADR-031 was a false saturated band.
 */

import { decodeLogDensity, type RasterChannel, type RasterData } from '@/data/curated'
import type { GeoTime } from '@/types/layer'

import { globeBlendAt, type GlobeBlend } from './blend'
import { srgbHexToLinear } from './color'
import { clamp01 } from './effects/math'
import { glslFloat } from './glsl'

// ------------------------------------------------------------------------------------ ramp

export interface DensityRampStop {
  /** People per km² at which this stop's colour and alpha are reached exactly. */
  density: number
  /** The stop's colour as authored — what `DensityRampKey.tsx` puts straight into a CSS
   *  gradient, so the key and the globe can only ever show the same ramp. */
  hex: string
  /** `hex` in the linear-light space `GLOBE_FRAGMENT_SHADER` composites in (`color.ts`). */
  color: readonly [number, number, number]
  alpha: number
}

function stop(density: number, hex: string, alpha: number): DensityRampStop {
  return { density, hex, color: srgbHexToLinear(hex), alpha }
}

/**
 * The ramp, in real people/km². The first stop is the floor: below it HYDE's own modelled
 * density is indistinguishable from uninhabited, and the overlay draws nothing at all rather
 * than washing every continent with a faint tint. Stops are interpolated in `log10(1 + d)` —
 * the same space the publish-side encoding already spreads the byte range over, so the ramp
 * moves at a uniform rate across the texture's own precision rather than crowding six of its
 * seven stops into the top few bytes.
 *
 * The alpha curve was tuned against real sampled texels of the published 2015 CE frame rather
 * than by eye: remote Amazon 0.04-0.25/km² and Tibet 0.2 fall at or under the floor and draw
 * nothing; rural Iowa 6.7, the Argentine pampas 6.4 and the deep Congo 4.7 sit around a third
 * opaque, a visible tint with the terrain still reading through; the Netherlands 372 and
 * Jiangsu 1,154 are most of the way to opaque; Dhaka's own 0.35° cell, 8,204, is the ramp's
 * top. An earlier, flatter curve put rural Iowa at 0.62 and made most inhabited land read as
 * solid paint — the opposite failure to ADR-031's, and just as unreadable.
 */
export const DENSITY_RAMP: readonly DensityRampStop[] = [
  stop(0.5, '#3c1f63', 0),
  stop(2, '#5a2180', 0.22),
  stop(10, '#8a2599', 0.42),
  stop(50, '#c92aa6', 0.6),
  stop(250, '#f13fa8', 0.76),
  stop(1500, '#ff7ecb', 0.88),
  stop(8000, '#ffeaf6', 0.95),
]

function rampPosition(density: number): number {
  return Math.log10(1 + Math.max(0, density))
}

/**
 * The overlay's premultiplied-free `[r, g, b, a]` at `density` people/km², clamped flat below the
 * first stop and above the last. Piecewise-linear in `rampPosition`, evaluated as a chain of
 * clamped mixes so the GLSL twin below can be generated from the same stop list and produce
 * bit-for-bit the same shape.
 */
export function densityRampAt(density: number): readonly [number, number, number, number] {
  const x = rampPosition(density)
  const first = DENSITY_RAMP[0]!
  let r = first.color[0]
  let g = first.color[1]
  let b = first.color[2]
  let a = first.alpha
  for (let i = 1; i < DENSITY_RAMP.length; i++) {
    const from = DENSITY_RAMP[i - 1]!
    const to = DENSITY_RAMP[i]!
    const x0 = rampPosition(from.density)
    const x1 = rampPosition(to.density)
    const f = clamp01((x - x0) / (x1 - x0))
    r += (to.color[0] - r) * f
    g += (to.color[1] - g) * f
    b += (to.color[2] - b) * f
    a += (to.alpha - a) * f
  }
  return [r, g, b, a]
}

/** `densityRampAt`, restated in GLSL and generated from the very same `DENSITY_RAMP` array —
 *  every literal below is interpolated, never retyped, the same discipline `PROJECTION_GLSL`
 *  follows for the Equal Earth coefficients. */
export const DENSITY_RAMP_GLSL = /* glsl */ `
vec4 densityRampAt(float density) {
  float x = log(1.0 + max(density, 0.0)) / ${glslFloat(Math.LN10)};
  vec4 c = vec4(${DENSITY_RAMP[0]!.color.map(glslFloat).join(', ')}, ${glslFloat(DENSITY_RAMP[0]!.alpha)});
${DENSITY_RAMP.slice(1)
  .map((to, i) => {
    const from = DENSITY_RAMP[i]!
    const x0 = glslFloat(rampPosition(from.density))
    const x1 = glslFloat(rampPosition(to.density))
    const target = `vec4(${to.color.map(glslFloat).join(', ')}, ${glslFloat(to.alpha)})`
    return `  c = mix(c, ${target}, clamp((x - ${x0}) / (${x1} - ${x0}), 0.0, 1.0));`
  })
  .join('\n')}
  return c;
}

// The published 8-bit log encoding (pipeline/density_encoding.py), inverted: encoded is the
// texel's own channel in 0..1, dMax the published ceiling. The TS twin is decodeLogDensity in
// @/data/curated — same formula, same numbers. The parameter is not called "sample": that is a
// reserved word in GLSL ES 3.0 and the shader fails to compile with it.
float decodeLogDensity(float encoded, float dMax) {
  return pow(10.0, clamp(encoded, 0.0, 1.0) * (log(1.0 + dMax) / ${glslFloat(Math.LN10)})) - 1.0;
}
`

/** The single-channel selector the shader multiplies a texel by, from the layer's own published
 *  `encoding.channel` — a mask rather than a `switch` so the shader has no branch. */
export function densityChannelMask(channel: RasterChannel): [number, number, number] {
  return [channel === 'r' ? 1 : 0, channel === 'g' ? 1 : 0, channel === 'b' ? 1 : 0]
}

// ------------------------------------------------------------------------ domain and binding

/**
 * How far past the sequence's own oldest frame (10,000 BCE) the overlay eases in from nothing.
 * The brief's own framing: the density overlay should take over as the arrival arcs finish, and
 * a hard edge exactly at the first frame would pop.
 *
 * Deliberately a real year count, not a warp width: this band sits entirely inside the Holocene,
 * where the symlog axis is close to linear anyway, and it is anchored to a *data* edge rather
 * than to playback. What it shows across the band is the 10,000 BCE frame itself, eased in — at
 * that date HYDE models roughly four million people worldwide, so every texel in the band is at
 * or near the ramp's own floor and the overlay is, correctly, almost nothing to see.
 */
export const DENSITY_FADE_BAND_YEARS = 2_500

/**
 * The overlay's own weight at `t`: 1 at and below the sequence's oldest frame, easing to 0 across
 * `DENSITY_FADE_BAND_YEARS` older than it, and 0 beyond. Never fades *out* toward the present —
 * HYDE 3.2 ends at 2015 CE and `densityBlendAt` holds that frame, the same "data ends, held
 * after" rule ADR-031 established for cleared land.
 */
export function densityStrengthAt(data: RasterData, t: GeoTime): number {
  const oldest = data.frames[data.frames.length - 1]!.t
  if (t <= oldest) return 1
  return clamp01((oldest + DENSITY_FADE_BAND_YEARS - t) / DENSITY_FADE_BAND_YEARS)
}

/**
 * The two frames to bind at `t`, clamped to the sequence's own domain at both ends: the newest
 * frame is held from 2015 CE to the present (the data simply ends), and the oldest frame is what
 * the fade-in band above shows. `null` only once `t` is past the band entirely, which is also
 * exactly when `densityStrengthAt` is 0 — so nothing is ever fetched for a `t` that would not
 * draw it.
 */
export function densityBlendAt(data: RasterData, t: GeoTime, assetBase: string): GlobeBlend | null {
  if (densityStrengthAt(data, t) <= 0) return null
  const newest = data.frames[0]!.t
  const oldest = data.frames[data.frames.length - 1]!.t
  return globeBlendAt(data, Math.min(oldest, Math.max(newest, t)), assetBase)
}

/** Whether the overlay has anything to draw at `t` — the "Human civilisation" legend row reads
 *  this alongside the arrivals' and cities' own equivalents. */
export function densityHasDataAt(data: RasterData | null, t: GeoTime): boolean {
  return data !== null && densityStrengthAt(data, t) > 0
}

/** A density reading straight from a published raster's own encoding, for a caller holding a
 *  normalised texel (a canvas read, a unit test) rather than a GPU sample. Throws when the layer
 *  publishes no `encoding` — a density overlay over a colour-only raster is a wiring bug, not a
 *  value to guess a default for. */
export function decodeDensityTexel(data: RasterData, unitSample: number): number {
  if (data.encoding === undefined) {
    throw new Error(`${data.id}: no published encoding — cannot decode it as a density raster`)
  }
  return decodeLogDensity(unitSample, data.encoding.dMax)
}
