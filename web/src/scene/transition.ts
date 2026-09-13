/**
 * Easing for the scene crossfade (ADR-012: a smooth whole-image dissolve replaced the
 * noise-masked reveal + blur-through). The only shaping left once the transition is a plain
 * alpha blend of two full frames is *how* `mix` maps to that alpha — a smoothstep, so the
 * fade eases in and out instead of moving at a constant rate.
 */

/** Smoothstep of `mix`, clamped to `[0, 1]` first. Exact `0` at `mix = 0` and exact `1` at
 *  `mix = 1`, so a fully-settled scene (`mix` 0 or 1, per `sceneAt`) still renders as a plain
 *  single image with no residual blend — the crossfade only ever does work strictly between
 *  the endpoints. */
export function crossfadeAlpha(mix: number): number {
  const m = Math.min(1, Math.max(0, mix))
  return m * m * (3 - 2 * m)
}
