/**
 * Formats a JS number as a GLSL float literal. GLSL requires a decimal point (or exponent) on a
 * float literal — a bare integer like `1` is parsed as an `int`, and using it where a `float` is
 * expected is a compile error (or, in a context that happens to accept it, silently the wrong
 * type). Every JS-number-into-GLSL-template interpolation in this package should go through this
 * rather than a bare `${n}`, which compiles fine today only because the current constants happen
 * to have a fractional part — and silently breaks the moment someone tunes one to a whole number.
 */
export function glslFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`
}
