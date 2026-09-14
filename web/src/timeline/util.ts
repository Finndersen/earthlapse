/** Shared numeric helpers used across the package. Kept tiny and dependency-free. */

/**
 * `NaN` compares false against everything, so a naive `value < min` / `value > max` clamp
 * silently lets `NaN` through unchanged — the opposite of what a clamp is for. `+-Infinity`
 * is handled correctly by that comparison already (it clamps to `max`/`min`), so only `NaN`
 * needs a special case.
 */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

export function clampUnit(u: number): number {
  return clamp(u, 0, 1)
}

/** Cubic ease-in-out, used by the symlog/linear scale toggle's ~1.2s collapse animation
 *  (`useAnimatedScale`). */
export function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
}
