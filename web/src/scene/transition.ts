/**
 * Pure uniform computation for the shader dissolve (see `shaders.ts`'s fragment shader,
 * consumed by `SceneCanvasView`). Two effects, both driven by `mix` alone:
 *
 * - a noise-masked dissolve: the shader compares a low-frequency noise field (biased by the
 *   incoming image's luminance, so bright regions resolve first) against a threshold that
 *   sweeps across the noise's whole range as `mix` goes 0 -> 1, with a feathered edge. `blur`
 *   is exported separately (`0` at both ends) as the *other* effect below;
 * - a blur-through that peaks at `mix = 0.5` and is exactly `0` at `mix = 0` and `1`.
 *
 * `threshold` is constructed so that at `mix = 0` the feathered band around it lies entirely
 * above the noise field's `[0, 1]` range (every pixel reads "before") and at `mix = 1` it
 * lies entirely below it (every pixel reads "after") — combined with `blur = 0` at both ends,
 * the fragment shader's output there is `texture2D` of the single image, unfiltered and
 * pixel-identical, no partial reveal or softening left over from the dissolve machinery.
 */

export interface TransitionUniforms {
  /** Clamped to `[0, 1]`. */
  mix: number
  /** Centre of the noise threshold's feathered band. `1 + edge` at `mix = 0`, `-edge` at
   *  `mix = 1`, moving linearly between — see the module doc comment for why those bounds. */
  threshold: number
  /** Half-width of the feathered band around `threshold`. Constant. */
  edge: number
  /** How strongly a pixel's luminance nudges it ahead of (or behind) the noise threshold. */
  luminanceBias: number
  /** Normalised 0..1 blur strength, `0` at `mix` 0 and 1, peaking at `mix = 0.5`. Callers
   *  scale it to their own units (a UV-space radius for the shader, a CSS px value for the
   *  `<img>` fallback). */
  blur: number
}

const EDGE = 0.12
const LUMINANCE_BIAS = 0.18

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

export function transitionUniforms(mix: number): TransitionUniforms {
  const m = clamp01(mix)
  // The endpoints are special-cased rather than left to the general lerp: `1 + EDGE - m *
  // (1 + 2 * EDGE)` is algebraically exact at m = 0 and m = 1, but floating-point rounding in
  // that subtraction can leave `threshold + edge` a hair above 0 at m = 1 (or `threshold -
  // edge` a hair below 1 at m = 0), which would let a sliver of the noise field's range fall
  // inside the feathered band and break the "pixel-identical at the endpoints" guarantee.
  const threshold = m === 0 ? 1 + EDGE : m === 1 ? -EDGE : 1 + EDGE - m * (1 + 2 * EDGE)
  const blur = 4 * m * (1 - m)
  return { mix: m, threshold, edge: EDGE, luminanceBias: LUMINANCE_BIAS, blur }
}
