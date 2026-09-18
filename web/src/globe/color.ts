/**
 * sRGB hex to linear-light RGB. Every colour this package composites in a fragment shader is a
 * *linear* value — `GLOBE_FRAGMENT_SHADER` and friends end with `#include <colorspace_fragment>`,
 * which re-encodes the finished frame for the sRGB canvas (`shaders.ts`'s own note on why a raw
 * `ShaderMaterial` does not get that for free). three.js does this conversion silently inside
 * `new THREE.Color('#...')`; this is the same conversion as a pure function, so a colour can be
 * written once as the hex a stylesheet also uses and reach a shader uniform, an instanced vertex
 * attribute and a CSS gradient stop without three separate hand-converted copies.
 */

/** The sRGB electro-optical transfer function, per IEC 61966-2-1 — identical to three.js's own
 *  `SRGBToLinear`, so a colour converted here matches one three.js converted itself. */
export function srgbToLinear(channel: number): number {
  return channel < 0.04045 ? channel * 0.0773993808 : Math.pow(channel * 0.9478672986 + 0.0521327014, 2.4)
}

/** `'#rrggbb'` (with or without the `#`) to a linear `[r, g, b]` triple in 0..1. Throws on a
 *  malformed string rather than silently rendering black. */
export function srgbHexToLinear(hex: string): readonly [number, number, number] {
  const digits = hex.startsWith('#') ? hex.slice(1) : hex
  if (!/^[0-9a-fA-F]{6}$/.test(digits)) {
    throw new Error(`srgbHexToLinear: expected a 6-digit hex colour, got "${hex}"`)
  }
  const value = Number.parseInt(digits, 16)
  return [
    srgbToLinear(((value >> 16) & 0xff) / 255),
    srgbToLinear(((value >> 8) & 0xff) / 255),
    srgbToLinear((value & 0xff) / 255),
  ]
}
