/**
 * Tiny numeric helpers shared by every effect envelope in this directory. No three.js, no
 * React — every function here is pure in its arguments, mirroring the GLSL `smoothstep` the
 * shader side uses for the same curves (`shaders.ts`), so the CPU-computed weights and the
 * GPU-rendered look agree.
 */

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/** Clamped Hermite interpolation, identical to GLSL's `smoothstep`: 0 at/below `edge0`, 1
 *  at/above `edge1`, eased between. `edge0` must be less than `edge1`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const f = clamp01((x - edge0) / (edge1 - edge0))
  return f * f * (3 - 2 * f)
}
