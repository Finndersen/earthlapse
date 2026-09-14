/**
 * GLSL for the globe sphere and its atmosphere rim. Plain strings, not `.glsl` files, so no
 * extra build-time loader is needed for two small shaders.
 */

/** Radius of the atmosphere shell, as a multiple of the planet's. */
export const ATMOSPHERE_SCALE = 1.15

/**
 * UV is derived from the OBJECT-space normal (not world/view space), deliberately: the
 * sphere auto-rotates by mutating its own `rotation.y` each frame (see `Globe.tsx`), and the
 * texture must be glued to the surface and rotate with it, not stay fixed as the mesh turns
 * underneath it.
 *
 * Longitude uses `-atan2(z, x)`. three.js's own equirectangular chunk uses `+atan2(z, x)`, but
 * that is for environment maps seen from *inside* the sphere; on a globe seen from outside the
 * same sign puts west on the viewer's right (Australia left of India, Africa right of it). The
 * negation keeps east on the right, with a single seam. Latitude uses `asin(y)`; combined with
 * `texture.flipY = false` on load (see `textureCache.ts`), `v = 0` samples row 0 of the
 * source PNG — the top of the image — so north stays up.
 */
export const GLOBE_VERTEX_SHADER = /* glsl */ `
varying vec3 vNormal;

void main() {
  vNormal = normal;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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

// docs/GLOBE.md G8 (§4.2): blend weight per pre-1 Ga regime, computed on the CPU
// (web/src/globe/effects/regimes.ts) so the long, soft crossfades there don't need porting
// into GLSL. Order: x = magma ocean, y = Hadean water world, z = Archean haze,
// w = Proterozoic geography-unknown.
uniform vec4 uRegimeWeights;
// docs/GLOBE.md §4.3 (G6): Snowball/Paleoproterozoic ice-shell intensity, 0..1.
uniform float uIceShell;
// docs/GLOBE.md §5.3 (G6): Chicxulub's global darkening veil, 0 (clear) .. 1 (near-black).
uniform float uImpactWinterVeil;
// The same event's brief flash, and where to draw it (shaders.ts's own uv formula below,
// inverted by effects/overlays.ts's anchorUv — see its doc comment for the present-day-only
// approximation this carries).
uniform float uImpactFlash;
uniform vec2 uImpactFlashAnchorUv;
// The Moon-forming impact's brief flash (G6), global — moon-forming-impact carries no anchor.
uniform float uGiantImpactFlash;
// Wall-clock seconds, *not* t: drives the magma-ocean crack shimmer and water-world steam
// drift. Non-informational decoration, the same precedent as Globe.tsx's own auto-rotate
// (mesh.rotation.y += delta) — see effects/index.ts's integration note. Defaults to 0
// (static, not broken) when left unwired.
uniform float uTime;

varying vec3 vNormal;

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
  vec2 uv = vec2(
    0.5 - atan(n.z, n.x) / (2.0 * PI),
    0.5 - asin(clamp(n.y, -1.0, 1.0)) / PI
  );

  vec3 dataColor = mix(texture2D(uBefore, uv).rgb, texture2D(uAfter, uv).rgb, uMix);
  vec3 baseColor = mix(NEUTRAL_COLOR, dataColor, uHasData);

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

  float diffuse = 0.72 + 0.36 * max(dot(n, normalize(LIGHT_DIR)), 0.0);
  gl_FragColor = vec4(baseColor * diffuse, 1.0);

  // docs/GLOBE.md §2.3/§9 G2: textures are sRGB and three.js decodes them to linear on
  // sampling (texture.colorSpace, textureCache.ts), so every colour above is linear. A plain
  // ShaderMaterial's fragment shader is user-authored GLSL, so — unlike three.js's built-in
  // materials — it does not automatically re-encode its output for the renderer's sRGB
  // canvas (WebGLProgram only appends the \`linearToOutputTexel\` function, not a call to it).
  // Without this, linear values are written straight to the sRGB framebuffer and read back
  // too dark — most visibly on open ocean, which measured near-black instead of navy.
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

varying vec3 vNormal;
varying vec3 vViewDir;

const float PLANET_LIMB_COSINE = ${Math.sqrt(1 - 1 / ATMOSPHERE_SCALE ** 2).toFixed(4)};

void main() {
  float d = abs(dot(normalize(vNormal), normalize(vViewDir)));
  float glow = pow(clamp(d / PLANET_LIMB_COSINE, 0.0, 1.0), 3.0);
  gl_FragColor = vec4(uColor, glow * 0.42);

  // Same sRGB re-encoding as GLOBE_FRAGMENT_SHADER above, and for the same reason: a raw
  // ShaderMaterial never gets it for free.
  #include <colorspace_fragment>
}
`
