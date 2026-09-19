/**
 * Formats a JS number as a GLSL float literal. GLSL requires a decimal point (or exponent): a
 * bare `1` parses as an `int`, which is a compile error where a `float` is expected (or silently
 * the wrong type where it isn't). Every JS-number-into-GLSL interpolation in this package must go
 * through this rather than a bare `${n}` — that only compiles while the constant happens to have
 * a fractional part, and breaks the moment one is tuned to a whole number.
 */
export function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`
}
