/**
 * The population-density overlay's pure core: how a published `hyde_population_density` texel
 * decodes to real people per km² and what colour that density reads as. No three.js, no React —
 * the same pure-core split `blend.ts` and `arcs.ts` follow. The overlay's fade-in/bind-frame
 * logic lives in `overlay.ts` now, generic over every kind the globe's single overlay slot can
 * hold (ADR-041) — this module keeps only what is genuinely population-density-specific.
 *
 * **Decoded honestly, then mapped.** The published texture is a single 8-bit channel holding
 * `round(255 · log10(1 + d) / log10(1 + dMax))` (`pipeline/density_encoding.py`, `dMax = 15,000`
 * people/km²). Nothing here treats that byte as a colour: `decodeLogDensity` (`@/data/curated`,
 * the TS twin of the pipeline's own decoder) turns it back into people/km² first, and
 * `densityRampAt` is defined on *that* quantity, with its stops written in real units. The
 * selector's legend key (`OverlayRampKey.tsx`) is generated from the same stops, so what the
 * globe paints and what the key claims cannot drift.
 *
 * **Why this ramp.** A linear-fraction overlay spread thinly across a huge range and earthy
 * ochre/olive tints sit in the same hue family as the terrain underneath — both make an overlay
 * too subtle to see. This ramp fixes both: the quantity is log-spaced (one stop per rough order
 * of magnitude, 2 to 8,000 people/km²), and the hues run dark violet → magenta → hot pink →
 * near-white, a family with no counterpart in Natural Earth II's greens, tans and blues (nor this
 * layer's own arrivals amber or cities cyan — `humanStyle.ts`), so even the faintest inhabited
 * band reads as an artificial overlay rather than terrain. Lightness rises monotonically stop to
 * stop, so the ramp reads as a sensible scale in greyscale or at low alpha too. Alpha climbs with
 * density as well, so an empty ocean or desert shows the basemap untouched while a city core is
 * nearly opaque.
 *
 * **Calibration, not just visibility.** The alpha curve is tuned against real sampled texels of
 * the published 2015 CE frame (see `DENSITY_RAMP`'s own doc comment for the reference points):
 * true rainforest interior (Congo basin, deep Amazon) sits at a few people/km² and reads as a
 * faint tint the terrain shows through, while genuinely dense farmland and cities (Netherlands,
 * Jiangsu, the Ganges plain) climb toward the ramp's ceiling. The low end is deliberately
 * backloaded so a large, faint rural area and a small, genuinely dense one don't read as the same
 * intensity — every stop shares one hue family by design, so opacity is the only remaining cue.
 *
 * **Mip strategy.** The overlay's texture cache uses `'boxFilter'` mips and `NoColorSpace`
 * (`humanEraTextureCache.ts`, see its own doc comment) — these bytes are numeric, not
 * gamma-encoded colour, and population density is spatially sharp (a city core beside an empty
 * hinterland), the same aliasing risk `humanEraTextureCache.ts` motivates boxFilter mips for. One
 * honest caveat: box-filtering *encoded* bytes averages the log, a geometric mean, so a minified
 * texel reads a little *below* the true area average rather than above it — under-claiming, the
 * right direction for an overlay whose failure mode is a false saturated band.
 */

import { decodeLogDensity, type RasterChannel, type RasterData } from '@/data/curated'

import { srgbHexToLinear } from './color'
import { clamp01 } from './effects/math'
import { glslFloat } from './glsl'

// ------------------------------------------------------------------------------------ ramp

export interface DensityRampStop {
  /** People per km² at which this stop's colour and alpha are reached exactly. */
  density: number
  /** The stop's colour as authored — what `OverlayRampKey.tsx` puts straight into a CSS
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
 * Alphas are set against real sampled texels of the published 2015 CE frame, not by eye, and the
 * curve has to survive two opposite failures. Too much weight low down and sparse rainforest and
 * dense farmland sit a hue apart in the same magenta family, so most inhabited land reads as
 * solid paint. Too little and genuinely dense regions vanish. Representative values:
 *
 * | Location | people/km² | alpha |
 * |---|---|---|
 * | Amazon interior, away from river towns | ~2.7 | 0.05 |
 * | Congo basin interior, Afar lowland | ~7.6-8.3 | 0.09 |
 * | Asir mountains, SW Saudi | ~73 | 0.22 |
 * | Ethiopian highlands, rural | ~449 | 0.43 |
 * | Yemen western highlands | ~1,070 | 0.57 |
 * | Ganges plain, rural Bihar | ~1,747 | 0.64 |
 * | Dhaka's own 0.35° cell | ~8,000 | 0.85 |
 *
 * Highland density in the Horn of Africa and Arabia is real, not an artefact: the highlands are
 * cool, wetter and malaria-free while the neighbouring lowlands are desert (Afar 8/km², Ogaden
 * 14, Rub' al Khali 0), so the overlay correctly inverts the usual "mountains are empty" reading.
 * The same holds for the hard northern edge along the Himalaya, where the Gangetic plain stops at
 * the foothills. Neither is a reason to reweight the ramp.
 *
 * At 1024×512 a cell is ~0.35°, so narrow features average against their surroundings — the Nile
 * valley samples ~36/km² because each cell mixes river and desert. That is a resolution limit of
 * the published texture, not of this ramp.
 */
export const DENSITY_RAMP: readonly DensityRampStop[] = [
  stop(0.5, '#3c1f63', 0),
  stop(2, '#5a2180', 0.04),
  stop(10, '#8a2599', 0.1),
  stop(50, '#c92aa6', 0.18),
  stop(250, '#f13fa8', 0.34),
  stop(1500, '#ff7ecb', 0.62),
  stop(8000, '#ffeaf6', 0.85),
]

/** The stop a selector swatch or legend key stands for this overlay with: the hot pink at 250
 *  people/km², the ramp's most recognisable colour and near the middle of its inhabited range.
 *  Resolved from the stop list rather than retyped, so retuning that stop retunes the swatch. */
export const DENSITY_SWATCH_HEX = DENSITY_RAMP[4]!.hex

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

// ------------------------------------------------------------------------------ texel decode

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
