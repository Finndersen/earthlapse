/**
 * The cleared-land overlay's pure core: how a published `hyde_cleared_land` texel collapses to a
 * single severity scalar, and what colour that severity reads as. No three.js, no React — mirrors
 * `density.ts`'s split for the population-density overlay, which this one shares the globe's
 * single overlay slot with (`overlay.ts`).
 *
 * **Colour-only, not log-encoded.** `hyde_cleared_land` publishes no `encoding` block: its three
 * channels are plain per-cell area fractions in 0..1 — R cropland, G pasture + converted
 * rangeland, B natural rangeland (HYDE 3.2 land-use classes). There is nothing to decode; the
 * severity collapse below is the whole of the "how do these bytes become a number" step.
 */

import { srgbHexToLinear } from './color'
import { clamp01 } from './effects/math'
import { glslFloat } from './glsl'

// ------------------------------------------------------------------------------------ severity

/**
 * The per-channel weights a texel's `[r, g, b]` is dotted against to collapse it to one severity
 * scalar — the same instruction `densityChannelMask`'s output feeds, applied to weights instead
 * of a single-channel mask.
 *
 * Cropland (R) is full severity: tilled ground. Pasture/converted rangeland (G) is weighted 0.6
 * — modified but not tilled. Natural rangeland (B) is weighted 0 and excluded outright: it is not
 * cleared land, and where it is present it occupies roughly half a cell versus cropland's roughly
 * a third, so on a shared severity scale the *least*-modified land would paint the *most*
 * intensely — the Sahel/savanna false positive the pasture/rangeland split exists to avoid. A
 * future selector entry can show natural rangeland on its own; it must never be blended back in
 * here.
 */
export const CLEARED_LAND_WEIGHTS: readonly [number, number, number] = [1, 0.6, 0]

// ------------------------------------------------------------------------------------ ramp

export interface ClearedLandRampStop {
  /** Collapsed severity (0..1) at which this stop's colour and alpha are reached exactly. */
  severity: number
  /** The stop's colour as authored — what a future legend key puts straight into a CSS gradient,
   *  so the key and the globe can only ever show the same ramp. */
  hex: string
  /** `hex` in the linear-light space `GLOBE_FRAGMENT_SHADER` composites in (`color.ts`). */
  color: readonly [number, number, number]
  alpha: number
}

function stop(severity: number, hex: string, alpha: number): ClearedLandRampStop {
  return { severity, hex, color: srgbHexToLinear(hex), alpha }
}

/**
 * The ramp, in collapsed severity. Interpolated *linearly* in severity, unlike density's log
 * spacing — cleared land is a plain fraction over a narrow effective range, not four orders of
 * magnitude. The first stop is the floor: below it, HYDE's own modelling noise at ~1% of a cell
 * is not a signal, and the overlay draws nothing at all.
 *
 * Alphas trace `severity ** 0.45 * 0.88`, front-loaded so sparse pre-industrial clearing (1500 CE
 * Europe) is still visible rather than lost near zero.
 *
 * `#7c3632` oxblood is the anchor — the colour that means worked ground, tilled earth reading as
 * red-brown soil. It separates from the graded Natural Earth II basemap on both hue and
 * luminance, the test a gold/ochre tint fails on both counts (it matches desert in hue and
 * lightness). Lightness and chroma rise together toward rust `#d6733f` at full clearing, so
 * intensity reads in greyscale too and a high-alpha texel never muddies into terrain shadow.
 */
export const CLEARED_LAND_RAMP: readonly ClearedLandRampStop[] = [
  stop(0.015, '#6b3330', 0.0),
  stop(0.05, '#7c3632', 0.22),
  stop(0.2, '#93402f', 0.42),
  stop(0.45, '#ad4e32', 0.6),
  stop(0.75, '#c25e38', 0.74),
  stop(1.0, '#d6733f', 0.88),
]

/**
 * The overlay's premultiplied-free `[r, g, b, a]` at `severity`, clamped flat below the first
 * stop and above the last. Piecewise-linear in severity, evaluated as a chain of clamped mixes so
 * the GLSL twin below can be generated from the same stop list and produce bit-for-bit the same
 * shape.
 */
export function clearedLandRampAt(severity: number): readonly [number, number, number, number] {
  const first = CLEARED_LAND_RAMP[0]!
  let r = first.color[0]
  let g = first.color[1]
  let b = first.color[2]
  let a = first.alpha
  for (let i = 1; i < CLEARED_LAND_RAMP.length; i++) {
    const from = CLEARED_LAND_RAMP[i - 1]!
    const to = CLEARED_LAND_RAMP[i]!
    const f = clamp01((severity - from.severity) / (to.severity - from.severity))
    r += (to.color[0] - r) * f
    g += (to.color[1] - g) * f
    b += (to.color[2] - b) * f
    a += (to.alpha - a) * f
  }
  return [r, g, b, a]
}

/** The ramp's anchor stop — the oxblood the rest of the ramp is built around, and the colour a
 *  selector swatch or legend key stands for this overlay with. Resolved from the stop list rather
 *  than retyped, so retuning that stop retunes everything that names the overlay by colour. */
export const CLEARED_LAND_SWATCH_HEX = CLEARED_LAND_RAMP[1]!.hex

/** `clearedLandRampAt`, restated in GLSL and generated from the very same `CLEARED_LAND_RAMP`
 *  array — every literal below is interpolated, never retyped, the same discipline
 *  `DENSITY_RAMP_GLSL` follows. No decode function: the severity scalar is used as-is, unlike
 *  density's log-encoded byte. */
export const CLEARED_LAND_RAMP_GLSL = /* glsl */ `
vec4 clearedLandRampAt(float severity) {
  vec4 c = vec4(${CLEARED_LAND_RAMP[0]!.color.map(glslFloat).join(', ')}, ${glslFloat(CLEARED_LAND_RAMP[0]!.alpha)});
${CLEARED_LAND_RAMP.slice(1)
  .map((to, i) => {
    const from = CLEARED_LAND_RAMP[i]!
    const x0 = glslFloat(from.severity)
    const x1 = glslFloat(to.severity)
    const target = `vec4(${to.color.map(glslFloat).join(', ')}, ${glslFloat(to.alpha)})`
    return `  c = mix(c, ${target}, clamp((severity - ${x0}) / (${x1} - ${x0}), 0.0, 1.0));`
  })
  .join('\n')}
  return c;
}
`
