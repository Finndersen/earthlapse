/**
 * GLSL for the ancestor portrait's flow-warped crossfade (ADR-015). Plain strings, as in
 * `scene/shaders.ts`.
 *
 * `uAlpha` 0 is the older plate alone, 1 the younger alone, both pixel-exact. In between, the
 * older plate is warped toward the younger by `uAlpha` of its forward field and the younger
 * toward the older by `1 - uAlpha` of its backward field, then the two are blended in linear
 * light:
 *
 *   older'(x)   = older(x - alpha * F(x))          F: older(p) ~ younger(p + F(p))
 *   younger'(x) = younger(x - (1 - alpha) * B(x))  B: younger(q) ~ older(q + B(q))
 *
 * Plates sample as their stored sRGB-encoded bytes (`portraitTextures.ts` uploads every texture
 * with `NoColorSpace`), so a settled plate is written out exactly as the published file, and
 * `srgbToLinear` / `linearToSrgb` bracket only the blend. The output is never re-encoded.
 *
 * Flow texels decode as (byte - 128) / 127 * range (`decodeFlowByte`), in plate UV with v down
 * the image; textures load with flipY, so v is negated to move in texture space.
 */

export const PORTRAIT_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const PORTRAIT_FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uOlder;
uniform sampler2D uYounger;
uniform sampler2D uForward;
uniform sampler2D uBackward;
uniform float uForwardRange;
uniform float uBackwardRange;
uniform float uAlpha;
uniform float uHasFlow;

varying vec2 vUv;

vec2 flowAt(sampler2D field, float range, vec2 uv) {
  vec2 displacement = (texture2D(field, uv).rg * 255.0 - 128.0) / 127.0 * range;
  return vec2(displacement.x, -displacement.y);
}

vec3 srgbToLinear(vec3 c) {
  return pow(c, vec3(2.2));
}

vec3 linearToSrgb(vec3 c) {
  return pow(c, vec3(1.0 / 2.2));
}

void main() {
  if (uAlpha <= 0.0) {
    gl_FragColor = texture2D(uOlder, vUv);
    return;
  }
  if (uAlpha >= 1.0) {
    gl_FragColor = texture2D(uYounger, vUv);
    return;
  }

  vec2 olderUv = vUv;
  vec2 youngerUv = vUv;
  if (uHasFlow > 0.5) {
    olderUv = vUv - uAlpha * flowAt(uForward, uForwardRange, vUv);
    youngerUv = vUv - (1.0 - uAlpha) * flowAt(uBackward, uBackwardRange, vUv);
  }

  vec3 older = srgbToLinear(texture2D(uOlder, olderUv).rgb);
  vec3 younger = srgbToLinear(texture2D(uYounger, youngerUv).rgb);
  gl_FragColor = vec4(linearToSrgb(mix(older, younger, uAlpha)), 1.0);
}
`
