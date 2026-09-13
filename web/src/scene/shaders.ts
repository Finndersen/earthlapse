/**
 * GLSL for the scene viewport's full-viewport quad. Plain strings, not `.glsl` files, so no
 * extra build-time loader is needed for one small shader (mirrors `globe/shaders.ts`).
 *
 * The vertex shader bypasses the camera entirely — `position.xy` is already in clip space —
 * the standard "full-screen quad" trick, paired with a `[2, 2]` `planeGeometry`. The fragment
 * shader does three things, all pure functions of the uniforms computed in `transition.ts` /
 * `drift.ts`:
 *
 * 1. `coverUV` reproduces CSS `object-fit: cover` — crop, don't letterbox, to fill the
 *    viewport regardless of its aspect ratio relative to the source images.
 * 2. `driftUV` applies each layer's own camera drift (`uFromZoom`/`uFromOffset`,
 *    `uToZoom`/`uToOffset`) on top of that crop.
 * 3. The noise-masked dissolve + blur-through described in `transition.ts`'s doc comment.
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
uniform float uThreshold;
uniform float uEdge;
uniform float uLuminanceBias;
uniform float uBlur;
uniform float uAspect;
uniform float uFromZoom;
uniform vec2 uFromOffset;
uniform float uToZoom;
uniform vec2 uToOffset;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

/** Smooth (bilinearly-interpolated) value noise — low frequency by construction once the
 *  caller scales p down before sampling. */
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/** CSS object-fit: cover — crop the longer axis so the image fills uv fully. aspect is
 *  viewport-aspect / image-aspect. */
vec2 coverUV(vec2 uv, float aspect) {
  vec2 scale = aspect > 1.0 ? vec2(1.0, aspect) : vec2(1.0 / aspect, 1.0);
  return (uv - 0.5) * scale + 0.5;
}

/** Zoom in (crop toward centre) and pan within the margin that crop affords. */
vec2 driftUV(vec2 uv, float zoom, vec2 offset) {
  return (uv - 0.5) / zoom + 0.5 + offset;
}

/** A cheap 5-tap box blur. radius <= 0.0 (exactly, both dissolve endpoints) takes the
 *  single-sample branch, so the result is a plain unfiltered texture2D there. */
vec3 blurSample(sampler2D tex, vec2 uv, float radius) {
  if (radius <= 0.0) {
    return texture2D(tex, uv).rgb;
  }
  vec3 sum = texture2D(tex, uv).rgb * 0.4;
  sum += texture2D(tex, uv + vec2(radius, 0.0)).rgb * 0.15;
  sum += texture2D(tex, uv - vec2(radius, 0.0)).rgb * 0.15;
  sum += texture2D(tex, uv + vec2(0.0, radius)).rgb * 0.15;
  sum += texture2D(tex, uv - vec2(0.0, radius)).rgb * 0.15;
  return sum;
}

void main() {
  vec2 base = coverUV(vUv, uAspect);
  vec2 fromUV = driftUV(base, uFromZoom, uFromOffset);
  vec2 toUV = driftUV(base, uToZoom, uToOffset);

  vec3 fromColor = blurSample(uFrom, fromUV, uBlur);
  vec3 toColor = blurSample(uTo, toUV, uBlur);

  float n = valueNoise(vUv * 3.0);
  float luminance = dot(toColor, vec3(0.299, 0.587, 0.114));
  float reveal = clamp(n + uLuminanceBias * (luminance - 0.5), 0.0, 1.0);
  float alpha = smoothstep(uThreshold - uEdge, uThreshold + uEdge, reveal);

  vec3 color = mix(fromColor, toColor, alpha);
  gl_FragColor = vec4(color, 1.0);
}
`
