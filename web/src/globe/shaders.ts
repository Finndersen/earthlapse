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

/** Lit with a high ambient floor: the globe is a small orb read against a near-black lens
 *  edge, so a deep terminator makes half of it vanish rather than adding form. */
export const GLOBE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uBefore;
uniform sampler2D uAfter;
uniform float uMix;
uniform float uHasData;

varying vec3 vNormal;

const float PI = 3.14159265359;
const vec3 NEUTRAL_COLOR = vec3(0.10, 0.12, 0.16);
const vec3 LIGHT_DIR = vec3(0.4, 0.6, 0.7);

void main() {
  vec3 n = normalize(vNormal);
  vec2 uv = vec2(
    0.5 - atan(n.z, n.x) / (2.0 * PI),
    0.5 - asin(clamp(n.y, -1.0, 1.0)) / PI
  );

  vec3 dataColor = mix(texture2D(uBefore, uv).rgb, texture2D(uAfter, uv).rgb, uMix);
  vec3 baseColor = mix(NEUTRAL_COLOR, dataColor, uHasData);

  float diffuse = 0.72 + 0.36 * max(dot(n, normalize(LIGHT_DIR)), 0.0);
  gl_FragColor = vec4(baseColor * diffuse, 1.0);
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
}
`
