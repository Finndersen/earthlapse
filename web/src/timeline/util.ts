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

/**
 * Fits `[lo, hi]` inside `[0, domainMax]` by sliding the whole window rather than clamping
 * each edge independently — an independent clamp shrinks the span whenever the window starts
 * outside the domain on one side (e.g. `[-50, 10]` naively clamps to `[0, 10]`, losing 50
 * units of span it should have kept by sliding to `[0, 60]` instead). Only shrinks the span
 * as a last resort, when it exceeds `domainMax` itself.
 */
export function clampWindowToDomain(lo: number, hi: number, domainMax: number): readonly [number, number] {
  let a = lo
  let b = hi
  if (a < 0) {
    b -= a
    a = 0
  }
  if (b > domainMax) {
    a -= b - domainMax
    b = domainMax
  }
  return [clamp(a, 0, domainMax), clamp(b, 0, domainMax)]
}

/** Cubic ease-in-out, shared by every ~250-350ms UI-chrome animation in this package (the
 *  symlog/linear scale toggle, and eased window changes) so they all feel like the same
 *  instrument rather than a grab-bag of easing curves. */
export function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
}
