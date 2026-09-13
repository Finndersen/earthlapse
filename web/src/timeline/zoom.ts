/** Zooming the visible window (DESIGN §3: "continuous zoom from a 4.6 Gyr span to a 1-year
 *  span"). */

import { EARTH_FORMATION, type GeoTime, type ScaleKind } from '@/types/layer'

import { unwarpFor, warpFor, type TimeWindow } from './scale'
import { clamp, clampUnit } from './util'

/** Narrowest window `zoomWindow` will produce. */
export const MIN_SPAN_YEARS = 1

function assertZoomableScaleKind(kind: ScaleKind): asserts kind is 'symlog' | 'linear' {
  if (kind !== 'symlog' && kind !== 'linear') {
    throw new Error(
      `zoomWindow: scaleKind "${kind}" is not implemented by web/src/timeline (density is out of scope for W7)`,
    )
  }
}

/** Clamps a window to the domain and to `MIN_SPAN_YEARS`, widening around its midpoint
 *  rather than just clamping each edge independently (which could otherwise invert
 *  `newest`/`oldest` at the extremes). */
function clampWindow(newest: GeoTime, oldest: GeoTime): TimeWindow {
  let lo = clamp(newest, 0, EARTH_FORMATION)
  let hi = clamp(oldest, 0, EARTH_FORMATION)
  if (hi - lo < MIN_SPAN_YEARS) {
    const mid = (lo + hi) / 2
    lo = clamp(mid - MIN_SPAN_YEARS / 2, 0, EARTH_FORMATION - MIN_SPAN_YEARS)
    hi = lo + MIN_SPAN_YEARS
  }
  return [lo, hi]
}

/**
 * Zooms `window` around `anchorU` (0..1 in the *current* window, oldest-to-newest per the
 * package orientation) by `factor`, in `scaleKind`'s warped space — so the point under the
 * cursor stays under the cursor, and equal wheel deltas feel equal regardless of where in
 * deep time the window currently sits. `factor > 1` zooms in (narrower span), `factor < 1`
 * zooms out (wider span).
 *
 * Clamped to `[0, EARTH_FORMATION]` and to a span of `[MIN_SPAN_YEARS, EARTH_FORMATION]` —
 * the latter enforced in years-space by `clampWindow` at the end, not by a warped-space
 * floor: how much warped width one year of span occupies varies by orders of magnitude
 * across the domain (symlog's slope is `1 / (t + SYMLOG_C)`), so a single global warped
 * lower bound would either be too loose near the present or, deep in the past, force a span
 * far wider than one year. All warped-space arithmetic stays within
 * `[0, warp(EARTH_FORMATION)]`, which is finite for both supported kinds, so no combination
 * of `anchorU`/`factor` can produce `NaN` or `Infinity` here.
 */
export function zoomWindow(window: TimeWindow, anchorU: number, factor: number, scaleKind: ScaleKind): TimeWindow {
  assertZoomableScaleKind(scaleKind)
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error(`zoomWindow: factor must be a positive finite number, got ${factor}`)
  }

  const [newest, oldest] = clampWindow(window[0], window[1])
  const u = clampUnit(anchorU)

  const wFull = warpFor(scaleKind, EARTH_FORMATION)

  const wNewest = clamp(warpFor(scaleKind, newest), 0, wFull)
  const wOldest = clamp(warpFor(scaleKind, oldest), 0, wFull)
  const currentWidth = wOldest - wNewest
  const anchorW = wOldest - u * currentWidth

  const newWidth = clamp(currentWidth / factor, 0, wFull)

  let newWOldest = anchorW + u * newWidth
  let newWNewest = newWOldest - newWidth
  // Slide back inside the warped domain if the anchor would push an edge out of it, keeping
  // newWidth exact rather than clamping each edge independently and distorting the span.
  if (newWNewest < 0) {
    newWNewest = 0
    newWOldest = newWidth
  }
  if (newWOldest > wFull) {
    newWOldest = wFull
    newWNewest = wFull - newWidth
  }

  return clampWindow(unwarpFor(scaleKind, newWNewest), unwarpFor(scaleKind, newWOldest))
}
