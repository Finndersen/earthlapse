/**
 * GLSL for the scene viewport's full-viewport quad. Plain strings, not `.glsl` files, so no
 * extra build-time loader is needed for one small shader (mirrors `globe/shaders.ts`).
 *
 * The vertex shader bypasses the camera entirely — `position.xy` is already in clip space —
 * the standard "full-screen quad" trick, paired with a `[2, 2]` `planeGeometry`. The fragment
 * shader does three things, all pure functions of the uniforms computed in `presentation.ts`
 * (`mix`, via `transition.ts`'s `crossfadeAlpha`) and `drift.ts`:
 *
 * 1. `coverUV` reproduces CSS `object-fit: cover` — crop, don't letterbox, to fill the
 *    viewport regardless of its aspect ratio relative to the source images.
 * 2. `driftUV` applies each layer's own camera drift (`uFromZoom`/`uFromOffset`,
 *    `uToZoom`/`uToOffset`) on top of that crop.
 * 3. A smooth whole-image crossfade (ADR-012), gamma-correct so the midpoint of the blend
 *    doesn't read as darker/muddier than either endpoint.
 */

export const SCENE_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const SCENE_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform float uMix;
uniform float uAspect;
uniform float uFromZoom;
uniform vec2 uFromOffset;
uniform float uToZoom;
uniform vec2 uToOffset;

varying vec2 vUv;

/** CSS object-fit: cover — crop the longer axis so the image fills uv fully. aspect is
 *  viewport-aspect / image-aspect: > 1 means the viewport is relatively wider, so only a
 *  1/aspect band of the image's height is shown; < 1 means only an aspect-wide band of its
 *  width is. Both scale factors stay <= 1, so sampling never leaves [0, 1]. */
vec2 coverUV(vec2 uv, float aspect) {
  vec2 scale = aspect > 1.0 ? vec2(1.0, 1.0 / aspect) : vec2(aspect, 1.0);
  return (uv - 0.5) * scale + 0.5;
}

/** Zoom in (crop toward centre) and pan within the margin that crop affords. */
vec2 driftUV(vec2 uv, float zoom, vec2 offset) {
  return (uv - 0.5) / zoom + 0.5 + offset;
}

/** Approximate sRGB <-> linear-light round trip, applied only to the interior of the blend
 *  below (see main()) — a straight alpha mix of sRGB-encoded texels darkens the midpoint of a
 *  crossfade, since sRGB stores light non-linearly. Never touched at uMix's endpoints, which
 *  take the raw sampled texel unmodified. */
vec3 srgbToLinear(vec3 c) {
  return pow(c, vec3(2.2));
}
vec3 linearToSrgb(vec3 c) {
  return pow(c, vec3(1.0 / 2.2));
}

void main() {
  vec2 base = coverUV(vUv, uAspect);
  vec2 fromUV = driftUV(base, uFromZoom, uFromOffset);
  vec2 toUV = driftUV(base, uToZoom, uToOffset);

  // Exact at both ends: the single sampled texel, untouched by the blend math below — so a
  // fully-settled scene (uMix 0 or 1, per sceneAt) is pixel-identical to a plain image.
  if (uMix <= 0.0) {
    gl_FragColor = texture2D(uFrom, fromUV);
    return;
  }
  if (uMix >= 1.0) {
    gl_FragColor = texture2D(uTo, toUV);
    return;
  }

  vec3 fromLinear = srgbToLinear(texture2D(uFrom, fromUV).rgb);
  vec3 toLinear = srgbToLinear(texture2D(uTo, toUV).rgb);
  vec3 blended = linearToSrgb(mix(fromLinear, toLinear, uMix));
  gl_FragColor = vec4(blended, 1.0);
}
`
