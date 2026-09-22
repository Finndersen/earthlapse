/**
 * Sea-level lowstand: which shallow shelves read as dry land when global sea level falls.
 *
 * No elevation raster is published for the globe, only colour. But PaleoDEM's frames are drawn
 * through one fixed hypsometric palette (`pipeline/palette.py`), and its sea half rises
 * monotonically in red from the deepest trench to the coast, so a sea texel's depth can be read
 * back from its red channel. That is the elevation used here, for both the PaleoDEM era and the
 * basemap era: the 0 Ma PaleoDEM frame stays bound under Natural Earth II, which carries no
 * usable bathymetry of its own. The read-back is rough (1° source grid, lossy WebP, bilinear
 * filtering: about ±15 m on the shelf), which is the resolution this schematic lowstand claims.
 *
 * A texel is painted as exposed shelf only where the *displayed* base is water (PaleoDEM sea, or
 * Natural Earth II's own water colour once the basemap has crossfaded in), so dry land is never
 * repainted, and the coarse PaleoDEM coast can only ever extend the fine basemap coast outward.
 */

import { srgbHexToLinear } from '../color'
import { glslFloat } from '../glsl'

/** `pipeline/palette.py`'s `SEA_STOPS`, mirrored by value: (elevation m, sRGB 0-255). Only the
 *  red channel is decoded; it strictly increases with elevation across every stop. */
export const PALEODEM_SEA_STOPS: readonly (readonly [number, readonly [number, number, number]])[] = [
  [-11000, [8, 12, 48]],
  [-6000, [10, 25, 90]],
  [-3000, [18, 60, 140]],
  [-1000, [30, 100, 180]],
  [-200, [60, 140, 200]],
  [0, [110, 180, 220]],
]

/** Elevation (m, <= 0) of a PaleoDEM sea texel whose sRGB red channel (0-255) is `red`:
 *  the inverse of the palette's sea half, clamped to its end stops. */
export function paleodemSeaDepthFromRed(red: number): number {
  const first = PALEODEM_SEA_STOPS[0]!
  if (red <= first[1][0]) return first[0]
  for (let i = 1; i < PALEODEM_SEA_STOPS.length; i += 1) {
    const [z0, [r0]] = PALEODEM_SEA_STOPS[i - 1]!
    const [z1, [r1]] = PALEODEM_SEA_STOPS[i]!
    if (red <= r1) return z0 + ((z1 - z0) * (red - r0)) / (r1 - r0)
  }
  return PALEODEM_SEA_STOPS[PALEODEM_SEA_STOPS.length - 1]![0]
}

/** How far blue must exceed green (sRGB 0-255) before a texel reads as water. Every PaleoDEM sea
 *  stop has blue 36-80 above green and every land stop has blue at or below green; Natural Earth
 *  II's water samples at ~40 above, its ice at ~12 and its land below zero. */
export const WATER_BLUE_OVER_GREEN: readonly [number, number] = [18, 30]

/** Sea level (m) at and above which nothing is drawn: a few metres of lowstand are below what
 *  the colour read-back can resolve and would only flicker coastal texels. */
export const MIN_VISIBLE_LOWSTAND_M = 6

/** Exposed shelf in the PaleoDEM era: the palette's own colour at sea level, so a new coastal
 *  plain reads like the land beside it. */
const PALEODEM_SHELF_HEX = '#1e783c'
/** Exposed shelf under the Natural Earth II basemap, before its tone grade: a pale steppe tone
 *  close to the basemap's own tundra and grassland. */
const BASEMAP_SHELF_HEX = '#bcbfa0'

function vec3(hex: string): string {
  const [r, g, b] = srgbHexToLinear(hex)
  return `vec3(${glslFloat(r)}, ${glslFloat(g)}, ${glslFloat(b)})`
}

function seaDepthGlsl(): string {
  const [firstZ, [firstR]] = PALEODEM_SEA_STOPS[0]!
  const lines = [`  if (red <= ${glslFloat(firstR)}) return ${glslFloat(firstZ)};`]
  for (let i = 1; i < PALEODEM_SEA_STOPS.length; i += 1) {
    const [z0, [r0]] = PALEODEM_SEA_STOPS[i - 1]!
    const [z1, [r1]] = PALEODEM_SEA_STOPS[i]!
    lines.push(
      `  if (red <= ${glslFloat(r1)}) return mix(${glslFloat(z0)}, ${glslFloat(z1)}, (red - ${glslFloat(r0)}) / ${glslFloat(r1 - r0)});`,
    )
  }
  lines.push(`  return ${glslFloat(PALEODEM_SEA_STOPS[PALEODEM_SEA_STOPS.length - 1]![0])};`)
  return lines.join('\n')
}

/** GLSL for the lowstand. Needs `gradeBasemapColor` declared before it. */
export const SHELF_GLSL = /* glsl */ `
vec3 linearToSrgb255(vec3 c) {
  vec3 x = clamp(c, 0.0, 1.0);
  vec3 low = x * 12.92;
  vec3 high = 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055;
  return 255.0 * mix(high, low, vec3(lessThanEqual(x, vec3(0.0031308))));
}

float paleodemSeaDepth(float red) {
${seaDepthGlsl()}
}

// 1 for water, 0 for land or ice, from a linear colour sample.
float waterness(vec3 linearColor) {
  vec3 s = linearToSrgb255(linearColor);
  return smoothstep(${glslFloat(WATER_BLUE_OVER_GREEN[0])}, ${glslFloat(WATER_BLUE_OVER_GREEN[1])}, s.b - s.g);
}

// 1 where the PaleoDEM sample is land, or sea no deeper than seaLevel (m, <= 0).
float emergentAt(vec3 paleodemLinear, float seaLevel) {
  vec3 s = linearToSrgb255(paleodemLinear);
  float sea = waterness(paleodemLinear);
  float depth = paleodemSeaDepth(s.r);
  return mix(1.0, smoothstep(seaLevel - 8.0, seaLevel + 8.0, depth), sea);
}

float lowstandActive(float seaLevel) {
  return smoothstep(${glslFloat(MIN_VISIBLE_LOWSTAND_M)}, ${glslFloat(MIN_VISIBLE_LOWSTAND_M * 2.5)}, -seaLevel);
}

vec3 exposedShelfColor(float basemapStrength) {
  return mix(${vec3(PALEODEM_SHELF_HEX)}, gradeBasemapColor(${vec3(BASEMAP_SHELF_HEX)}), basemapStrength);
}
`
