/**
 * GLSL for the globe sphere and its atmosphere rim. Plain strings, not `.glsl` files, so no
 * extra build-time loader is needed for two small shaders.
 */

import { BASEMAP_GRADE_GAMMA, BASEMAP_GRADE_SATURATION, BASEMAP_GRADE_SCALE } from './blend'
import { CLEARED_LAND_RAMP_GLSL } from './clearedLand'
import { DENSITY_RAMP_GLSL } from './density'
import {
  EMPIRE_CASING,
  EMPIRE_CASING_WIDTH_PX,
  EMPIRE_DIM_ALPHA,
  EMPIRE_FILL_ALPHA,
  EMPIRE_HIGHLIGHT_FILL_ALPHA,
  EMPIRE_HIGHLIGHT_LINE_SCALE,
  EMPIRE_LINE_WIDTH_PX,
  EMPIRE_PALETTE,
} from './empireStyle'
import { EMPIRE_BANDS } from './empireTexture'
import { glslFloat } from './glsl'
import { overlayKindUniform } from './overlay'
import { ICE_SHEETS_GLSL } from './ice/iceSheets'
import { SHELF_GLSL } from './ice/shelf'
import { PROJECTION_GLSL } from './projection'

// GLSL int constant, generated rather than retyped so it cannot drift from overlay.ts's own
// mapping. glslFloat is the wrong helper for an int: it always appends a decimal point.
const OVERLAY_KIND_CLEARED_LAND_VALUE = overlayKindUniform('cleared_land')
if (!Number.isInteger(OVERLAY_KIND_CLEARED_LAND_VALUE)) {
  throw new Error('overlayKindUniform must return an integer for a GLSL int constant')
}

// empireOver unpacks eight slot channels from the texture's bands (empireTexture.ts).
if (EMPIRE_PALETTE.length !== 8) throw new Error('the empire coverage texture packs exactly eight palette slots')

/** A `#rrggbb` sRGB colour as a linear-light GLSL `vec3`, the space the globe composites in. */
function linearVec3(hex: string): string {
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return `vec3(${channels.map((c) => glslFloat(Number(c.toFixed(5)))).join(', ')})`
}

/** The preprocessor symbol that compiles the empire territories into the globe shader. Left
 *  undefined, the shader carries none of their code, so the orb (which never draws empires) does
 *  not depend on a GPU driver being able to compile by far the heaviest part of the shader. */
export const EMPIRES_DEFINE = 'EMPIRES'

/** The globe material's `defines`, with and without the empire territories. */
export const GLOBE_DEFINES_WITH_EMPIRES: Readonly<Record<string, string>> = { [EMPIRES_DEFINE]: '' }
export const GLOBE_DEFINES_WITHOUT_EMPIRES: Readonly<Record<string, string>> = {}

/** Whether a compiled shader's source is the globe's empire variant. */
export function isEmpireShaderSource(source: string): boolean {
  return new RegExp(`^#define ${EMPIRES_DEFINE}\\b`, 'm').test(source)
}

/** One palette slot's GLSL operands: its colour, and its components of the packed `vec4`s holding
 *  every slot's contour distance, highlight emphasis and fill alpha. */
interface EmpireSlot {
  colour: string
  distance: string
  emphasis: string
  fillAlpha: string
}

const EMPIRE_SLOTS: readonly EmpireSlot[] = EMPIRE_PALETTE.map((hex, k) => {
  const half = k < 4 ? 'Low' : 'High'
  const component = 'xyzw'[k % 4]!
  return {
    colour: linearVec3(hex),
    distance: `distance${half}.${component}`,
    emphasis: `emphasis${half}.${component}`,
    fillAlpha: `fillAlpha${half}.${component}`,
  }
})

/** One statement per palette slot, in slot order. Unrolled here rather than written as a GLSL loop
 *  over local arrays, which mobile compilers handle far less reliably than straight-line code. */
function eachEmpireSlot(statement: (slot: EmpireSlot) => string): string {
  return EMPIRE_SLOTS.map(statement).join('\n  ')
}

/**
 * The empire territories' fills and borders over `base`, from one coverage texture
 * (`empireTexture.ts` has the layout). Each palette slot's border is the half-way contour of its
 * coverage; `(a - 0.5) / |grad a|`, the gradient taken in screen space, is the fragment's signed
 * distance to it in device pixels (positive inside), so a line of fixed pixel width sits on it
 * whether a texel spans a tenth of a pixel or ten. The fill is cut at the same contour. Order
 * matches a painter: every fill, every casing, every line, then the highlighted lineage's.
 */
const EMPIRE_GLSL = /* glsl */ `
const vec3 EMPIRE_CASING_COLOUR = ${linearVec3(EMPIRE_CASING.colour)};
const float EMPIRE_CASING_ALPHA = ${glslFloat(EMPIRE_CASING.alpha)};
const float EMPIRE_LINE_WIDTH_PX = ${glslFloat(EMPIRE_LINE_WIDTH_PX)};
const float EMPIRE_CASING_WIDTH_PX = ${glslFloat(EMPIRE_CASING_WIDTH_PX)};
const float EMPIRE_FILL_ALPHA = ${glslFloat(EMPIRE_FILL_ALPHA)};
const float EMPIRE_HIGHLIGHT_FILL_ALPHA = ${glslFloat(EMPIRE_HIGHLIGHT_FILL_ALPHA)};
const float EMPIRE_HIGHLIGHT_LINE_SCALE = ${glslFloat(EMPIRE_HIGHLIGHT_LINE_SCALE)};
const float EMPIRE_DIM_ALPHA = ${glslFloat(EMPIRE_DIM_ALPHA)};
const float EMPIRE_BANDS = ${glslFloat(EMPIRE_BANDS)};

vec4 empireBand(sampler2D tex, vec2 uv, float band) {
  return texture2D(tex, vec2(uv.x, (band + uv.y) / EMPIRE_BANDS));
}

vec4 empireContourDistance(vec4 coverage) {
  vec4 dx = dFdx(coverage);
  vec4 dy = dFdy(coverage);
  return (coverage - 0.5) / max(sqrt(dx * dx + dy * dy), vec4(1e-4));
}

// Coverage of a line widthPx wide centred on the contour, antialiased over one pixel.
float empireLine(float distancePx, float widthPx) {
  return clamp(0.5 * widthPx + 0.5 - abs(distancePx), 0.0, 1.0);
}

// params: (fill on, highlighted slot or -1), from the texture's own empireTextureParams.
vec3 empireOver(vec3 base, sampler2D tex, vec2 params, float pixelRatio, vec2 uv) {
  vec4 band0 = empireBand(tex, uv, 0.0);
  vec4 band1 = empireBand(tex, uv, 1.0);
  vec4 band2 = empireBand(tex, uv, 2.0);
  vec4 slotsLow = vec4(band0.rgb, band1.r);
  vec4 slotsHigh = vec4(band1.gb, band2.rg);
  float highlightCoverage = band2.b;

  float fillOn = params.x;
  float highlightSlot = params.y;
  float dim = highlightSlot >= 0.0 ? EMPIRE_DIM_ALPHA : 1.0;

  vec4 distanceLow = empireContourDistance(slotsLow);
  vec4 distanceHigh = empireContourDistance(slotsHigh);
  // The share of a slot's coverage that is the highlighted lineage: 1 along its own border, 0 for
  // another lineage that happens to share its slot.
  vec4 emphasisLow = vec4(equal(vec4(0.0, 1.0, 2.0, 3.0), vec4(highlightSlot)))
    * clamp(highlightCoverage / max(slotsLow, vec4(1e-3)), 0.0, 1.0);
  vec4 emphasisHigh = vec4(equal(vec4(4.0, 5.0, 6.0, 7.0), vec4(highlightSlot)))
    * clamp(highlightCoverage / max(slotsHigh, vec4(1e-3)), 0.0, 1.0);
  vec4 fillAlphaLow = fillOn * mix(vec4(EMPIRE_FILL_ALPHA * dim), vec4(EMPIRE_HIGHLIGHT_FILL_ALPHA), emphasisLow);
  vec4 fillAlphaHigh = fillOn * mix(vec4(EMPIRE_FILL_ALPHA * dim), vec4(EMPIRE_HIGHLIGHT_FILL_ALPHA), emphasisHigh);

  float lineWidth = EMPIRE_LINE_WIDTH_PX * pixelRatio;
  float casingWidth = EMPIRE_CASING_WIDTH_PX * pixelRatio;
  float highlightLineWidth = lineWidth * EMPIRE_HIGHLIGHT_LINE_SCALE;
  float highlightCasingWidth = highlightLineWidth + casingWidth - lineWidth;
  // Cliopatria cuts territory at the antimeridian, often keeping only one side: a contour along
  // it is that cut, not a border, so no line is drawn within a line's width of it.
  float seamPx = min(uv.x, 1.0 - uv.x) / max(length(vec2(dFdx(uv.x), dFdy(uv.x))), 1e-6);
  float lineKeep = clamp(seamPx - 0.5 * highlightCasingWidth, 0.0, 1.0);

  vec3 color = base;
  ${eachEmpireSlot((s) => `color = mix(color, ${s.colour}, ${s.fillAlpha} * clamp(${s.distance} + 0.5, 0.0, 1.0));`)}
  ${eachEmpireSlot((s) => `color = mix(color, EMPIRE_CASING_COLOUR, lineKeep * EMPIRE_CASING_ALPHA * dim * (1.0 - ${s.emphasis}) * empireLine(${s.distance}, casingWidth));`)}
  ${eachEmpireSlot((s) => `color = mix(color, ${s.colour}, lineKeep * dim * (1.0 - ${s.emphasis}) * empireLine(${s.distance}, lineWidth));`)}
  ${eachEmpireSlot((s) => `color = mix(color, EMPIRE_CASING_COLOUR, lineKeep * ${s.emphasis} * EMPIRE_CASING_ALPHA * empireLine(${s.distance}, highlightCasingWidth));`)}
  ${eachEmpireSlot((s) => `color = mix(color, ${s.colour}, lineKeep * ${s.emphasis} * empireLine(${s.distance}, highlightLineWidth));`)}
  return color;
}
`

/** Radius of the atmosphere shell, as a multiple of the planet's. */
export const ATMOSPHERE_SCALE = 1.15

/**
 * Computes the vertex position from a plain `aLonLat` (degrees) attribute, not the mesh's own
 * `position`/`normal` (`globeGeometry.ts`'s grid supplies no others). `uUnfold` (0 = sphere, 1 =
 * Equal Earth map, docs/GLOBE.md §10) mixes `projection.ts`'s GLSL twin (`PROJECTION_GLSL`) every
 * frame, so one mesh morphs between the two rather than swapping geometry.
 *
 * `vNormal` is always the sphere position (unit length, doubling as its own normal), regardless
 * of `uUnfold`. Every fragment-shader effect needing a genuine 3D direction (lighting, the ice
 * shell's equator darkening) reads it directly, with no map-mode branch.
 *
 * `vUv` is computed from `aLonLat` here (`u = 0.5 + lon/360`, `v = 0.5 - lat/180`) rather than
 * derived per-fragment from `vNormal` via `atan2`/`asin`, for two reasons: it's identical in both
 * sphere and map mode, and `atan2` is discontinuous at ±180° — computing it per-fragment from an
 * interpolated normal makes the GPU's derivative-based mip selection see a jump at that seam,
 * picking a visibly-too-coarse mip level there (a dateline-shaped line on a mipmapped texture).
 * `aLonLat` has no such jump within a triangle (`globeGeometry.ts`'s seam columns are never
 * joined by a triangle), so deriving `vUv` from it in the vertex shader avoids the artefact.
 *
 * Combined with `texture.flipY = false` on load (`textureCache.ts`), `v = 0` samples the PNG's
 * top row, so north stays up.
 */
export const GLOBE_VERTEX_SHADER = /* glsl */ `
attribute vec2 aLonLat;
uniform float uUnfold;

${PROJECTION_GLSL}

varying vec3 vNormal;
varying vec2 vUv;

void main() {
  vNormal = lonLatToSphere(aLonLat);
  vUv = vec2(0.5 + aLonLat.x / 360.0, 0.5 - aLonLat.y / 180.0);
  vec3 localPosition = unfoldedPosition(aLonLat, uUnfold);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(localPosition, 1.0);
}
`

/**
 * Lit with a high ambient floor: the globe is a small orb read against a near-black lens
 * edge, so a deep terminator makes half of it vanish rather than adding form.
 *
 * Everything below `NEUTRAL_COLOR`/`LIGHT_DIR` is docs/GLOBE.md G6/G8: the pre-1 Ga regime
 * looks (§4.2), the Snowball/Paleoproterozoic ice shell (§4.3) and the Chicxulub/Moon-forming
 * impact effects (§5.3). Every new uniform defaults to WebGL's own zero-initialisation when a
 * `<shaderMaterial>` doesn't set it, so leaving them unwired (as this file alone does)
 * reproduces the plain PaleoDEM/neutral-sphere look exactly — see `effects/index.ts`'s
 * integration note for how `GlobeSphere` should wire real values in.
 */
export const GLOBE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform float uMix;
uniform float uHasData;
// docs/GLOBE.md §10: 0 (sphere) .. 1 (map). The vertex shader's uUnfold morphs position/uv;
// every color term below reads vUv, already unaffected (see GLOBE_VERTEX_SHADER). This uniform
// exists only for the diffuse light term below, the one thing that needs the sphere's real
// surface normal and has no sensible map equivalent.
uniform float uUnfold;

// docs/GLOBE.md G8 (§4.2): blend weight per pre-1 Ga regime, computed on the CPU
// (effects/regimes.ts) so its long crossfades don't need porting into GLSL. Order: x = magma
// ocean, y = Hadean water world, z = Archean haze, w = Proterozoic geography-unknown.
uniform vec4 uRegimeWeights;
// docs/GLOBE.md §4.3 (G6): Snowball/Paleoproterozoic ice-shell intensity, 0..1.
uniform float uIceShell;
// docs/GLOBE.md §5.3 (G6): Chicxulub's global darkening veil, 0 (clear) .. 1 (near-black).
uniform float uImpactWinterVeil;
// The same event's brief flash, and where to draw it (this shader's own vUv, matched by
// effects/overlays.ts's anchorUv — see its doc comment for the present-day-only approximation
// this carries).
uniform float uImpactFlash;
uniform vec2 uImpactFlashAnchorUv;
// The Moon-forming impact's brief flash (G6), global — moon-forming-impact carries no anchor.
uniform float uGiantImpactFlash;

// docs/GLOBE.md §10 (ADR-030): the Natural Earth II human-era basemap — one time-invariant
// texture per tier (blend.ts's basemapStrengthAt doc comment explains why it's a separate
// sampler rather than folded into uBefore/uAfter/uMix), mixed over the PaleoDEM dataColor.
// uBasemapStrength is 0 above 400 ka, ramping to 1 at and below 300 ka.
uniform sampler2D uBasemapTex;
uniform float uBasemapStrength;

// The globe's single raster-overlay slot (ADR-031 amendment): exactly one of population
// density or cleared land at a time, chosen by uOverlayKind (overlayKindUniform in
// overlay.ts; 0 = density, WebGL's zero-init default). uOverlayChannel is the per-channel
// weight vector both kinds' collapses are dotted against. The two bound frames mix in
// encoded space (uOverlayMix) — the same geometric-mean compromise the box-filtered mip
// chain already makes, monotonic either way. uOverlayStrength is 0 outside the active
// kind's domain, so this whole block is a no-op there.
uniform int uOverlayKind;
uniform sampler2D uOverlayBefore;
uniform sampler2D uOverlayAfter;
uniform float uOverlayMix;
uniform vec3 uOverlayChannel;
uniform float uOverlayDMax;
uniform float uOverlayStrength;

#ifdef ${EMPIRES_DEFINE}
// The historical-empires coverage textures (ADR-059, empireTexture.ts), drawn by empireOver.
// uEmpireMix crossfades between two active sets; uEmpireStrength is 0 while the layer is off or no
// texture is bound yet. Outside the domain the active set is empty, so the texture has no coverage.
uniform sampler2D uEmpireBefore;
uniform sampler2D uEmpireAfter;
uniform vec2 uEmpireBeforeParams;
uniform vec2 uEmpireAfterParams;
uniform float uEmpireMix;
uniform float uEmpireStrength;
uniform float uPixelRatio;
${EMPIRE_GLSL}
#endif

// docs/GLOBE.md §10 (ADR-030 amendment): the basemap tone-match grade — one TS constant each
// (blend.ts's gradeBasemapColor doc comment has the measurements and reasoning), interpolated
// here rather than hand-copied.
const float BASEMAP_GRADE_SCALE = ${glslFloat(BASEMAP_GRADE_SCALE)};
const float BASEMAP_GRADE_GAMMA = ${glslFloat(BASEMAP_GRADE_GAMMA)};
const float BASEMAP_GRADE_SATURATION = ${glslFloat(BASEMAP_GRADE_SATURATION)};

vec3 gradeBasemapColor(vec3 color) {
  vec3 graded = BASEMAP_GRADE_SCALE * pow(clamp(color, 0.0, 1.0), vec3(BASEMAP_GRADE_GAMMA));
  float luminance = dot(graded, vec3(0.2126, 0.7152, 0.0722));
  return clamp(luminance + (graded - luminance) * BASEMAP_GRADE_SATURATION, 0.0, 1.0);
}

${DENSITY_RAMP_GLSL}
${CLEARED_LAND_RAMP_GLSL}

const int OVERLAY_KIND_CLEARED_LAND = ${OVERLAY_KIND_CLEARED_LAND_VALUE};

// Dispatches the overlay slot's single encoded scalar to the active kind's own ramp. Density
// is the fallthrough branch deliberately, so an unrecognised (or zero-init) kind degrades to
// today's single-overlay behaviour rather than to nothing.
vec4 overlayColorAt(float encoded) {
  if (uOverlayKind == OVERLAY_KIND_CLEARED_LAND) {
    return clearedLandRampAt(clamp(encoded, 0.0, 1.0));
  }
  return densityRampAt(decodeLogDensity(encoded, max(uOverlayDMax, 1.0)));
}

// docs/GLOBE.md §5.1: the Cenozoic ice age (ice/). uSeaLevel is metres relative to present
// (negative in a glacial lowstand); uIceSheetRadius, declared in ICE_SHEETS_GLSL, is each schematic
// ice sheet's current angular radius. Both zero-initialised, so outside 0-34 Ma nothing is drawn.
uniform float uSeaLevel;
${SHELF_GLSL}
${ICE_SHEETS_GLSL}

// Wall-clock seconds, *not* t: drives the magma-ocean crack shimmer and water-world steam
// drift. Non-informational decoration, the same precedent as Globe.tsx's own auto-rotate
// (mesh.rotation.y += delta) — see effects/index.ts's integration note. Defaults to 0
// (static, not broken) when left unwired.
uniform float uTime;

varying vec3 vNormal;
varying vec2 vUv;

const float PI = 3.14159265359;
const vec3 NEUTRAL_COLOR = vec3(0.10, 0.12, 0.16);
const vec3 LIGHT_DIR = vec3(0.4, 0.6, 0.7);

// ---- shared noise -----------------------------------------------------------------------
// Standard hash + value-noise pair (no textures, no library): every regime look below is
// built from this so their "hand-drawn" quality reads as one consistent style.

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

// ---- G8 regime looks (docs/GLOBE.md §4.2) ------------------------------------------------

// Dark cooling crust, no oceans, cracked by a glowing network. The crack pattern itself is a
// fixed function of uv (so it doesn't swim as the sphere auto-rotates); uTime only shimmers
// its brightness, carrying no information of its own.
vec3 magmaOceanColor(vec2 uv) {
  vec3 crust = vec3(0.05, 0.02, 0.02);
  float n = valueNoise(uv * 18.0);
  float cracks = smoothstep(0.46, 0.50, n) - smoothstep(0.50, 0.55, n);
  float shimmer = 0.65 + 0.35 * sin(uTime * 1.7 + n * 20.0);
  vec3 glow = vec3(1.0, 0.45, 0.08) * cracks * shimmer;
  return crust + glow;
}

// A global dark ocean under a steam-veiled atmosphere (no continents: no plate reconstruction
// exists this far back). The veil drifts slowly with uTime — atmospheric motion, not a claim
// about t.
vec3 waterWorldColor(vec2 uv) {
  vec3 ocean = vec3(0.02, 0.05, 0.09);
  float steam = valueNoise(uv * 6.0 + vec2(uTime * 0.015, uTime * 0.008));
  vec3 veil = vec3(0.55, 0.58, 0.62) * smoothstep(0.55, 0.85, steam) * 0.35;
  return ocean + veil;
}

// An anoxic ocean with small scattered protocrust flecks at fixed procedural positions (no
// plate reconstruction, so nothing here should appear to drift). The orange-tan haze is
// contested and episodic (data/globe_regimes.yaml's archean-haze-regime); with no literature
// dates for individual episodes, it is shown only as a slow, non-informational shimmer
// (uTime) rather than invented on/off dates keyed to t.
vec3 archeanColor(vec2 uv) {
  vec3 ocean = vec3(0.03, 0.07, 0.09);
  float fleck = step(0.965, hash21(floor(uv * 60.0)));
  vec3 protocrust = vec3(0.25, 0.22, 0.18) * fleck;
  float hazePulse = 0.5 + 0.5 * sin(uTime * 0.15);
  vec3 haze = vec3(0.65, 0.45, 0.20) * 0.12 * hazePulse;
  return ocean + protocrust + haze;
}

// A dim, static land/sea noise field — "geography unknown" (docs/GLOBE.md §4.2): no motion,
// so it never implies a reconstruction this regime doesn't have.
vec3 unknownGeographyColor(vec2 uv) {
  float n = valueNoise(uv * 10.0);
  vec3 sea = vec3(0.05, 0.08, 0.10);
  vec3 land = vec3(0.15, 0.14, 0.11);
  return mix(sea, land, smoothstep(0.45, 0.55, n));
}

// ---- G6 overlays (docs/GLOBE.md §4.3, §5.3) ----------------------------------------------

// Bright, slightly translucent (never fully opaque — mixed by uIceShell below, capped under
// 1), with a faint equatorial darkening per §4.3's "faint equatorial darkening rather than
// asserting either" (the contested slushball-vs-solid question).
vec3 iceShellColor(vec3 n) {
  vec3 ice = vec3(0.88, 0.93, 0.97);
  float equatorDarken = 1.0 - 0.22 * (1.0 - abs(n.y));
  return ice * equatorDarken;
}

void main() {
  vec3 n = normalize(vNormal);
  // uv comes straight from the vertex shader's own vUv (aLonLat-derived, identical in both
  // sphere and map mode) — see GLOBE_VERTEX_SHADER's doc comment for why, and why it is not
  // recomputed here from n via atan2/asin.
  vec2 uv = vUv;

  vec3 dataColor = mix(texture2D(uBefore, uv).rgb, texture2D(uAfter, uv).rgb, uMix);
  vec3 baseColor = mix(NEUTRAL_COLOR, dataColor, uHasData);

  // docs/GLOBE.md §10 (ADR-030): the human-era basemap over the ordinary PaleoDEM base —
  // uBasemapStrength is 0 outside its crossfade band, so this is a no-op everywhere else.
  // gradeBasemapColor tone-matches Natural Earth II's own much paler, less saturated palette to
  // PaleoDEM's stylised one (this file's own BASEMAP_GRADE_* doc comment) so the crossfade doesn't
  // read as a brightness jump.
  vec3 basemapSample = texture2D(uBasemapTex, uv).rgb;
  baseColor = mix(baseColor, gradeBasemapColor(basemapSample), uBasemapStrength);

  // docs/GLOBE.md §5.1: the glacial lowstand's exposed shelf, painted only where the displayed
  // base is water — the depth itself is read back from the PaleoDEM sample, which stays bound
  // under the basemap (ice/shelf.ts).
  float displayedWater = mix(waterness(dataColor), waterness(basemapSample), uBasemapStrength) * uHasData;
  float lowstand = min(uSeaLevel, 0.0);
  float exposedShelf = emergentAt(dataColor, lowstand) * displayedWater * lowstandActive(lowstand);
  baseColor = mix(baseColor, exposedShelfColor(uBasemapStrength), exposedShelf);

  // The active overlay, over the basemap and under everything older. overlayColorAt dispatches
  // on uOverlayKind: density decodes its log-encoded byte before ramping it, cleared land ramps
  // its plain fraction directly. The two frames mix in encoded space — the same geometric-mean
  // compromise the box-filtered mip chain already makes, monotonic either way. uOverlayStrength
  // is 0 outside the active kind's domain, so this is a no-op everywhere else.
  float overlaySample = mix(
    dot(texture2D(uOverlayBefore, uv).rgb, uOverlayChannel),
    dot(texture2D(uOverlayAfter, uv).rgb, uOverlayChannel),
    uOverlayMix
  );
  vec4 overlayColor = overlayColorAt(overlaySample);
  baseColor = mix(baseColor, overlayColor.rgb, overlayColor.a * uOverlayStrength);

  // Empire territories over the overlay, so outlines stay legible on either ramp. Each side of the
  // crossfade is drawn whole and the results mixed, so a border fades rather than slides. The
  // branches are on uniforms, so derivatives inside stay defined, and a side not on screen (or the
  // whole layer, while off) costs nothing.
#ifdef ${EMPIRES_DEFINE}
  if (uEmpireStrength > 0.0) {
    vec3 empire;
    if (uEmpireMix <= 0.0) {
      empire = empireOver(baseColor, uEmpireBefore, uEmpireBeforeParams, uPixelRatio, uv);
    } else if (uEmpireMix >= 1.0) {
      empire = empireOver(baseColor, uEmpireAfter, uEmpireAfterParams, uPixelRatio, uv);
    } else {
      empire = mix(
        empireOver(baseColor, uEmpireBefore, uEmpireBeforeParams, uPixelRatio, uv),
        empireOver(baseColor, uEmpireAfter, uEmpireAfterParams, uPixelRatio, uv),
        uEmpireMix
      );
    }
    baseColor = mix(baseColor, empire, uEmpireStrength);
  }
#endif

  // docs/GLOBE.md §5.1: the schematic ice sheets, over the shelf and density, clipped at their
  // margins to land (including exposed shelf). Under the basemap only the ice beyond today's
  // extent is drawn — Natural Earth II already shows today's (ice/iceSheets.ts).
  float iceGround = max(1.0 - displayedWater, exposedShelf);
  baseColor = mix(baseColor, iceSheetColor(n), iceSheetCover(n, iceGround, uBasemapStrength) * 0.95);

  // G8: blend the active regime(s) over whatever the base look otherwise is. uRegimeWeights
  // sums to 0 outside every regime (base look untouched) and to ~1 in each regime's interior;
  // regimes.ts's crossfades are what keep two adjacent weights summing near 1 at a boundary.
  vec3 regimeColor = magmaOceanColor(uv) * uRegimeWeights.x
    + waterWorldColor(uv) * uRegimeWeights.y
    + archeanColor(uv) * uRegimeWeights.z
    + unknownGeographyColor(uv) * uRegimeWeights.w;
  float regimeTotal = clamp(uRegimeWeights.x + uRegimeWeights.y + uRegimeWeights.z + uRegimeWeights.w, 0.0, 1.0);
  baseColor = mix(baseColor, regimeColor, regimeTotal);

  // G6: ice shell over whatever's below (PaleoDEM data, a regime, or the neutral sphere) —
  // "eases in and out... over any underlying texture" (§4.3). 0.85 keeps it "slightly
  // translucent" even at full intensity, never fully opaque.
  baseColor = mix(baseColor, iceShellColor(n), uIceShell * 0.85);

  // G6: Chicxulub's global veil, near-black at full intensity (§5.3).
  baseColor = mix(baseColor, vec3(0.01, 0.01, 0.015), uImpactWinterVeil * 0.94);

  // G6: the same event's brief anchor-local flash. Antimeridian-aware in u; v (latitude) has
  // no "other side" of a pole to wrap to, so it isn't wrapped.
  float du = abs(uv.x - uImpactFlashAnchorUv.x);
  du = min(du, 1.0 - du);
  float dv = uv.y - uImpactFlashAnchorUv.y;
  float flashDist2 = du * du + dv * dv;
  baseColor += vec3(1.0, 0.85, 0.6) * uImpactFlash * exp(-flashDist2 * 220.0);

  // G6: the Moon-forming impact's flash is anchor-less (no location claimed) — a global pulse.
  baseColor += vec3(1.0) * uGiantImpactFlash * 0.5;

  // The one view-dependent term in this shader: a directional light read against the sphere's
  // own surface normal has no honest equivalent on a flat map (there is no "far side" to shade,
  // and a map lit from one corner would read as a lighting bug, not terrain). Neutralised to a
  // flat, fully-lit 1.0 as uUnfold rises, so the map reads evenly regardless of where on the
  // sphere a given point started — every colour term above (textures, regimes, ice shell,
  // impact veil/flash) is untouched by uUnfold and needs no equivalent branch.
  float sphereDiffuse = 0.72 + 0.36 * max(dot(n, normalize(LIGHT_DIR)), 0.0);
  float diffuse = mix(sphereDiffuse, 1.0, uUnfold);
  gl_FragColor = vec4(baseColor * diffuse, 1.0);

  // docs/GLOBE.md §2.3/§9 G2: textures are sRGB and three.js decodes them to linear on sampling
  // (texture.colorSpace, textureCache.ts), so every colour above is linear. A plain
  // ShaderMaterial is user-authored GLSL, so unlike three.js's built-in materials it does not
  // automatically re-encode its output for the renderer's sRGB canvas (WebGLProgram only
  // appends the \`linearToOutputTexel\` function, not a call to it) — without this, linear values
  // hit the sRGB framebuffer and read back too dark.
  #include <colorspace_fragment>
}
`

/** A soft atmospheric glow on a larger back-facing shell. */
export const RIM_VERTEX_SHADER = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
}
`

/**
 * On the shell's back faces, |dot(normal, view)| runs from 0 at the shell's own silhouette up
 * to PLANET_LIMB_COSINE where the line of sight grazes the planet (anything further in is
 * hidden behind the planet by the depth test). Normalising by it feathers the glow from full
 * strength at the planet's limb to nothing at the shell's edge, instead of a hard band.
 */
export const RIM_FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
// docs/GLOBE.md's ADR-033: fades the rim out as the globe unfolds — an atmospheric glow
// wrapped around a sphere has no sensible reading around a flat map, so rather than morph this
// shell's own geometry too, it simply recedes over the same span the sphere itself flattens.
uniform float uUnfold;

varying vec3 vNormal;
varying vec3 vViewDir;

const float PLANET_LIMB_COSINE = ${Math.sqrt(1 - 1 / ATMOSPHERE_SCALE ** 2).toFixed(4)};

void main() {
  float d = abs(dot(normalize(vNormal), normalize(vViewDir)));
  float glow = pow(clamp(d / PLANET_LIMB_COSINE, 0.0, 1.0), 3.0);
  gl_FragColor = vec4(uColor, glow * 0.42 * (1.0 - uUnfold));

  // Same sRGB re-encoding as GLOBE_FRAGMENT_SHADER above, and for the same reason: a raw
  // ShaderMaterial never gets it for free.
  #include <colorspace_fragment>
}
`
