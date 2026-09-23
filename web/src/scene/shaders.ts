/**
 * GLSL for the scene viewport's full-viewport quad. Plain strings, not `.glsl` files (mirrors
 * `globe/shaders.ts`).
 *
 * The vertex shader bypasses the camera entirely — `position.xy` is already in clip space — the
 * standard "full-screen quad" trick, paired with a `[2, 2]` `planeGeometry`. The fragment
 * shader does two things, all pure functions of the uniforms computed in `presentation.ts`
 * (`mix`, via `transition.ts`'s `crossfadeAlpha`) and `drift.ts`:
 *
 * 1. `sceneUV` maps the quad onto each layer's own crop window (`uFromWindow`/`uToWindow`,
 *    computed by `framing.ts`'s `coverWindow`: a cover fit centred on the scene's focus, zoomed
 *    in a portrait viewport by its portrait zoom), after
 *    applying that layer's camera drift (`uFromZoom`/`uFromOffset`, `uToZoom`/`uToOffset`)
 *    inside the window.
 * 2. A smooth whole-image crossfade (ADR-012), gamma-correct so the midpoint of the blend
 *    doesn't read as darker/muddier than either endpoint.
 *
 * Each layer is its full image (`uFrom`/`uTo`) or, until that loads, its thumbnail
 * (`uFromThumb`/`uToThumb`, ADR-051) under a small blur, so the upscale reads as soft rather than
 * blocky; `uFromSharp`/`uToSharp` fade from one to the other (0 thumbnail, 1 full). A thumbnail is
 * the image's centre square, so it samples through its own window (`uFromThumbWindow`), the crop
 * window re-expressed in the thumbnail's frame.
 *
 * Scenes sample as their stored sRGB-encoded bytes (`textureCache.ts` uploads every texture
 * with `NoColorSpace`, not `SRGBColorSpace` — the GPU must not decode them on sample), so a
 * settled scene is written out exactly as the published file, matching `SceneFallbackView`'s
 * `<img>`; `srgbToLinear`/`linearToSrgb` below bracket only the crossfade. No renderer output
 * encoding (`colorspace_fragment`) is applied, mirroring `layers/portraitShaders.ts`'s plate
 * blend.
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
uniform sampler2D uFromThumb;
uniform sampler2D uToThumb;
uniform float uFromSharp;
uniform float uToSharp;
uniform vec2 uThumbTexel;
uniform float uMix;
uniform vec4 uFromWindow;
uniform vec4 uToWindow;
uniform vec4 uFromThumbWindow;
uniform vec4 uToThumbWindow;
uniform float uFromZoom;
uniform vec2 uFromOffset;
uniform float uToZoom;
uniform vec2 uToOffset;

varying vec2 vUv;

/** Texture uv for quad uv. crop is (x, y, width, height) of the cover window in image fractions
 *  and offset is the drift in window fractions, both origin top-left and y down, so they are
 *  flipped against uv's y-up here. The drift zooms about the window centre and pans within the
 *  margin that zoom crops off the window, so sampling never leaves the window. */
vec2 sceneUV(vec2 uv, vec4 crop, float zoom, vec2 offset) {
  vec2 screen = vec2(uv.x, 1.0 - uv.y);
  vec2 local = (screen - 0.5) / zoom + 0.5 + offset;
  vec2 image = crop.xy + local * crop.zw;
  return vec2(image.x, 1.0 - image.y);
}

/** A 3x3 tent blur one thumbnail texel wide: bilinear upscaling alone leaves a visible texel grid. */
vec4 softSample(sampler2D thumb, vec2 uv) {
  vec4 sum = vec4(0.0);
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      float weight = (2.0 - abs(float(i))) * (2.0 - abs(float(j)));
      sum += weight * texture2D(thumb, uv + vec2(float(i), float(j)) * uThumbTexel);
    }
  }
  return sum / 16.0;
}

/** One layer's texel: the full image alone when sharp, so a settled scene stays pixel-exact. */
vec4 layerSample(sampler2D full, sampler2D thumb, vec2 fullUV, vec2 thumbUV, float sharp) {
  if (sharp >= 1.0) return texture2D(full, fullUV);
  vec4 soft = softSample(thumb, thumbUV);
  if (sharp <= 0.0) return soft;
  return mix(soft, texture2D(full, fullUV), sharp);
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
  vec2 fromUV = sceneUV(vUv, uFromWindow, uFromZoom, uFromOffset);
  vec2 toUV = sceneUV(vUv, uToWindow, uToZoom, uToOffset);
  vec2 fromThumbUV = sceneUV(vUv, uFromThumbWindow, uFromZoom, uFromOffset);
  vec2 toThumbUV = sceneUV(vUv, uToThumbWindow, uToZoom, uToOffset);

  // Exact at both ends: the single sampled texel, untouched by the blend math below — so a
  // fully-settled scene (uMix 0 or 1, per sceneAt) is pixel-identical to a plain image.
  if (uMix <= 0.0) {
    gl_FragColor = layerSample(uFrom, uFromThumb, fromUV, fromThumbUV, uFromSharp);
    return;
  }
  if (uMix >= 1.0) {
    gl_FragColor = layerSample(uTo, uToThumb, toUV, toThumbUV, uToSharp);
    return;
  }

  vec3 fromLinear = srgbToLinear(layerSample(uFrom, uFromThumb, fromUV, fromThumbUV, uFromSharp).rgb);
  vec3 toLinear = srgbToLinear(layerSample(uTo, uToThumb, toUV, toThumbUV, uToSharp).rgb);
  vec3 blended = linearToSrgb(mix(fromLinear, toLinear, uMix));
  gl_FragColor = vec4(blended, 1.0);
}
`
