/**
 * Schematic ice sheets: soft, noise-edged spherical caps ("domes") placed on the present-day
 * centres of the real Cenozoic ice sheets, each growing from its present radius toward its Last
 * Glacial Maximum radius as the LR04-derived ice-volume scalar rises. Deliberately rough — the
 * roadmap asks for a scalar-driven look, not a reconstruction — and plate-agnostic: the Northern
 * sheets only exist from 2.7 Ma, when continents sit where they are today, and the Antarctic cap
 * is centred on the pole, where Antarctica has been since the Eocene-Oligocene onset.
 *
 * A dome's edge is clipped to land (including shelf exposed by the lowstand) unless it is well
 * inside the dome, so Hudson Bay and the Ross and Weddell ice shelves are covered while the
 * sheet's margin follows the coast; `marine` lets a sheet also cover open sea at its margin, at
 * that opacity (the marine Barents-Kara sheet, Antarctic sea ice).
 *
 * Under the Natural Earth II basemap, which already shows today's Greenland and Antarctic ice,
 * only the extent beyond each dome's present radius is drawn, so present-day ice is never drawn
 * twice.
 */

import { srgbHexToLinear } from '../color'
import { glslFloat } from '../glsl'
import { lonLatToSphere } from '../projection'

export interface IceSheetDome {
  id: string
  lat: number
  lon: number
  /** Angular radius (degrees) at the present-day ice volume (0 = no ice today). */
  presentRadius: number
  /** Angular radius (degrees) at the Last Glacial Maximum. */
  lgmRadius: number
  /** Opacity of the dome over open sea at its margin, 0..1. */
  marine: number
  hemisphere: 'north' | 'south'
}

/** Centres and LGM reach chosen by eye against the mapped LGM ice limits (Dyke et al. 2002 for
 *  the Laurentide, Innuitian and Cordilleran sheets; Hughes et al. 2016, DATED-1, for Eurasia).
 *  A radius is the angular reach of the ice margin from its centre. */
export const ICE_SHEET_DOMES: readonly IceSheetDome[] = [
  { id: 'antarctica', lat: -90, lon: 0, presentRadius: 26, lgmRadius: 30, marine: 0.35, hemisphere: 'south' },
  { id: 'greenland', lat: 72.5, lon: -41, presentRadius: 11, lgmRadius: 14.5, marine: 0, hemisphere: 'north' },
  { id: 'laurentide-keewatin', lat: 61, lon: -95, presentRadius: 0, lgmRadius: 22, marine: 0, hemisphere: 'north' },
  { id: 'laurentide-labrador', lat: 54, lon: -70, presentRadius: 0, lgmRadius: 14, marine: 0, hemisphere: 'north' },
  { id: 'cordilleran', lat: 57, lon: -127, presentRadius: 0, lgmRadius: 10, marine: 0, hemisphere: 'north' },
  { id: 'innuitian', lat: 79, lon: -85, presentRadius: 0, lgmRadius: 9, marine: 0.6, hemisphere: 'north' },
  { id: 'fennoscandian', lat: 64, lon: 18, presentRadius: 0, lgmRadius: 12.5, marine: 0.3, hemisphere: 'north' },
  { id: 'british-irish', lat: 56, lon: -4.5, presentRadius: 0, lgmRadius: 5.5, marine: 0.3, hemisphere: 'north' },
  { id: 'barents-kara', lat: 77, lon: 50, presentRadius: 0, lgmRadius: 11, marine: 1, hemisphere: 'north' },
  { id: 'iceland', lat: 65, lon: -18.5, presentRadius: 0, lgmRadius: 4, marine: 0, hemisphere: 'north' },
]

export const ICE_SHEET_DOME_COUNT = ICE_SHEET_DOMES.length

/** Ice volume (LGM = 1) below which the Northern sheets stay at their present radius. LR04 wanders
 *  by ~0.05 of LGM ice across the Holocene; this keeps that noise from flickering ghost sheets. */
export const NORTHERN_GROWTH_THRESHOLD = 0.08

/** Radius grows as `volume^0.4`: ice-sheet volume scales with area^1.25 (Paterson 1994), so
 *  radius, ∝ area^0.5, goes as volume^0.4 — a sheet reads large early in a glacial and saturates
 *  near its maximum rather than growing linearly. */
const RADIUS_VOLUME_EXPONENT = 0.4

/** The largest glacials in LR04 (MIS 12, 16) run ~10% past the LGM; the Northern domes grow up to
 *  this multiple of their LGM growth and no further. */
const MAX_GROWTH = 1.12

/** How far the Antarctic cap's radius moves per unit of ice volume (degrees) — modest: its
 *  margin is mostly sea ice, which LR04's scalar only loosely tracks. */
const ANTARCTIC_DEGREES_PER_ICE_VOLUME = 4
const ANTARCTIC_VOLUME_RANGE: readonly [number, number] = [-0.6, 1.2]

export interface IceSheetDrivers {
  /** LR04-derived ice volume, LGM = 1, present = 0. */
  iceVolume: number
  /** 0..1: the Northern Hemisphere sheets' onset (none before ~2.7 Ma). */
  northernGate: number
  /** 0..1: Antarctica's onset (none before ~34 Ma). */
  antarcticGate: number
}

/** 0..MAX_GROWTH: how far a Northern dome has grown from its present toward its LGM radius. */
export function northernGrowth(iceVolume: number): number {
  const above = Math.max(0, iceVolume - NORTHERN_GROWTH_THRESHOLD) / (1 - NORTHERN_GROWTH_THRESHOLD)
  return Math.min(MAX_GROWTH, Math.pow(above, RADIUS_VOLUME_EXPONENT))
}

export function domeRadius(dome: IceSheetDome, drivers: IceSheetDrivers): number {
  if (dome.hemisphere === 'south') {
    const [lo, hi] = ANTARCTIC_VOLUME_RANGE
    const volume = Math.min(hi, Math.max(lo, drivers.iceVolume))
    return drivers.antarcticGate * Math.max(0, dome.presentRadius + ANTARCTIC_DEGREES_PER_ICE_VOLUME * volume)
  }
  const growth = northernGrowth(drivers.iceVolume)
  return drivers.northernGate * (dome.presentRadius + (dome.lgmRadius - dome.presentRadius) * growth)
}

/** Writes every dome's current radius (degrees, `ICE_SHEET_DOMES` order) into `out` and returns
 *  it, so the shader's uniform array is refilled in place rather than reallocated. */
export function writeIceSheetRadii(drivers: IceSheetDrivers, out: Float32Array): Float32Array {
  if (out.length !== ICE_SHEET_DOME_COUNT) {
    throw new Error(`writeIceSheetRadii: expected ${ICE_SHEET_DOME_COUNT} slots, got ${out.length}`)
  }
  ICE_SHEET_DOMES.forEach((dome, i) => {
    out[i] = domeRadius(dome, drivers)
  })
  return out
}

/** Natural Earth II's own ice (Greenland's interior, sampled from the published basemap), before
 *  its tone grade. The sheets use the basemap's graded ice colour in every era, so glacial ice
 *  grown around today's Greenland reads as the same ice rather than a brighter overlay. */
const BASEMAP_ICE_HEX = '#e0e7f3'

function vec3(hex: string): string {
  const [r, g, b] = srgbHexToLinear(hex)
  return `vec3(${glslFloat(r)}, ${glslFloat(g)}, ${glslFloat(b)})`
}

function domeCallGlsl(dome: IceSheetDome, index: number): string {
  const [x, y, z] = lonLatToSphere({ lat: dome.lat, lon: dome.lon })
  const centre = `vec3(${glslFloat(x)}, ${glslFloat(y)}, ${glslFloat(z)})`
  return `  ice = max(ice, iceDome(n, ${centre}, uIceSheetRadius[${index}], ${glslFloat(dome.presentRadius)}, ${glslFloat(dome.marine)}, land, edgeNoise, excessOnly));`
}

/**
 * GLSL for the ice sheets: `iceSheetCover(n, land, excessOnly)` is the 0..1 ice opacity at unit
 * sphere position `n` (the same `lonLatToSphere` frame as the dome centres), given how much of
 * the texel is land and how far to draw only the extent beyond present (the basemap's strength).
 * `iceSheetColor(n)` is the ice itself. Needs `gradeBasemapColor` declared before it.
 */
export const ICE_SHEETS_GLSL = /* glsl */ `
uniform float uIceSheetRadius[${ICE_SHEET_DOME_COUNT}];

float iceHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

float iceValueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float n000 = iceHash(i);
  float n100 = iceHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = iceHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = iceHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = iceHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = iceHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = iceHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = iceHash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
    mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y),
    u.z
  );
}

// Three octaves of 3D noise over the sphere, -1..1: no seam at the antimeridian and no pinching
// at the poles, unlike noise over uv. The finest octave keeps even the small domes ragged.
float iceEdgeNoise(vec3 n) {
  return (iceValueNoise(n * 9.0) * 0.5 + iceValueNoise(n * 23.0) * 0.3 + iceValueNoise(n * 57.0) * 0.2) * 2.0 - 1.0;
}

float iceDomeReach(float d, float radius) {
  float soft = 0.5 + 0.05 * radius;
  return 1.0 - smoothstep(radius - soft, radius + soft, d);
}

float iceDome(vec3 n, vec3 centre, float radius, float presentRadius, float marine, float land, float edgeNoise, float excessOnly) {
  if (radius <= 0.0) return 0.0;
  float d = degrees(acos(clamp(dot(n, centre), -1.0, 1.0))) + edgeNoise * (0.6 + 0.1 * radius);
  float reach = iceDomeReach(d, radius);
  float beyondPresent = presentRadius > 0.0 ? max(reach - iceDomeReach(d, presentRadius), 0.0) : reach;
  float drawn = mix(reach, beyondPresent, excessOnly);
  float interior = smoothstep(0.35, 0.6, 1.0 - d / radius);
  return drawn * max(max(land, interior), marine);
}

float iceSheetCover(vec3 n, float land, float excessOnly) {
  if (${ICE_SHEET_DOMES.map((_, i) => `uIceSheetRadius[${i}] <= 0.0`).join(' && ')}) return 0.0;
  float edgeNoise = iceEdgeNoise(n);
  float ice = 0.0;
${ICE_SHEET_DOMES.map(domeCallGlsl).join('\n')}
  return ice;
}

vec3 iceSheetColor(vec3 n) {
  float grain = iceValueNoise(n * 31.0);
  return gradeBasemapColor(${vec3(BASEMAP_ICE_HEX)}) * (0.94 + 0.08 * grain);
}
`
