/** Zooming the visible window (DESIGN §3: "continuous zoom from a 4.6 Gyr span to a 1-year
 *  span"). */

import { EARTH_FORMATION, type GeoTime, type ScaleKind } from '@/types/layer'

import { unwarpFor, warpFor, type TimeWindow } from './scale'
import { clamp, clampUnit, clampWindowToDomain } from './util'

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

/**
 * Pans `window` by `deltaU` — a fraction of the window's own warped width, in the same `u`
 * orientation as every scale in this package (positive `deltaU` moves the window toward the
 * present, i.e. toward `u = 1`). The span is kept exactly constant; the window only slides,
 * clamped to `[0, EARTH_FORMATION]` by `clampWindowToDomain` rather than shrunk. Used for
 * shift+wheel / horizontal-wheel panning on the scrub track — plain wheel zooms instead, see
 * `ScrubTrack`.
 *
 * The raw-time shift is derived from a single reference point — the window's warped centre —
 * moved by `deltaU` and converted back. That shift is then applied identically, in RAW time,
 * to both bounds. Shifting each bound independently by the same *warped* amount instead would
 * distort the span under a nonlinear warp like symlog (equal warped steps cover unequal raw
 * years at different points in deep time); a pan gesture's whole point is to hold the raw
 * years-span the user is looking at fixed, so raw years is the right space to shift it in.
 */
export function panWindow(window: TimeWindow, deltaU: number, scaleKind: ScaleKind): TimeWindow {
  assertZoomableScaleKind(scaleKind)
  if (!Number.isFinite(deltaU)) {
    throw new Error(`panWindow: deltaU must be finite, got ${deltaU}`)
  }

  const [newest, oldest] = clampWindow(window[0], window[1])
  const wNewest = warpFor(scaleKind, newest)
  const wOldest = warpFor(scaleKind, oldest)
  const width = wOldest - wNewest
  if (width <= 0) return [newest, oldest]

  const wCentre = (wNewest + wOldest) / 2
  const tCentre = unwarpFor(scaleKind, wCentre)
  // Subtracting moves the reference point toward smaller warped values for positive deltaU —
  // smaller raw t, i.e. toward the present, matching this function's documented orientation.
  const tShifted = unwarpFor(scaleKind, wCentre - deltaU * width)
  const rawShift = tCentre - tShifted

  const [slidNewest, slidOldest] = clampWindowToDomain(newest - rawShift, oldest - rawShift, EARTH_FORMATION)
  return clampWindow(slidNewest, slidOldest)
}

/** Padding applied on each side of an event's uncertainty band when framing it (README §2:
 *  "frame its uncertainty band with padding"), as a fraction of the band's own width. */
export const EVENT_FRAME_PADDING_FACTOR = 0.5

/** Fallback padding, in years, for a point event (`tMin === tMax`) that has no band width of
 *  its own to take a fraction of. Small relative to every span this package renders above
 *  `MIN_SPAN_YEARS`, and `clampWindow`'s own floor is the final safety net regardless. */
const POINT_EVENT_PADDING_YEARS = MIN_SPAN_YEARS * 10

/**
 * The window that frames `[tMin, tMax]` with `EVENT_FRAME_PADDING_FACTOR` of the band's width
 * as padding on each side (README §2: double-click an event marker to frame it). Clamped to
 * the domain and to `MIN_SPAN_YEARS` the same way `zoomWindow` is.
 */
export function frameEventWindow(tMin: GeoTime, tMax: GeoTime): TimeWindow {
  if (!(tMax >= tMin)) {
    throw new Error(`frameEventWindow: tMax must be >= tMin, got tMin=${tMin}, tMax=${tMax}`)
  }
  const band = tMax - tMin
  const padding = band > 0 ? band * EVENT_FRAME_PADDING_FACTOR : POINT_EVENT_PADDING_YEARS
  return clampWindow(tMin - padding, tMax + padding)
}

/**
 * Resizes a window by dragging one edge while `anchor` (the *other*, un-dragged edge) stays
 * fixed — the minimap bracket's edge handles, and its brush-select fallback (`Minimap.tsx`)
 * where `anchor` is instead the pointer-down position. `pointerT` is the raw time under the
 * cursor.
 *
 * Unlike a naive `clamp(pointerT, anchor + MIN_SPAN_YEARS, ...)`, dragging the moving edge
 * *past* `anchor` does not collapse the window to `MIN_SPAN_YEARS` and get stuck there: the
 * pair is always re-sorted (`newest = min(anchor, pointerT)`, `oldest = max(...)`), so crossing
 * over smoothly flips which bound `anchor` itself is, and the window keeps growing on the far
 * side as the drag continues — exactly the "never inverts or collapses" behaviour a draggable
 * bracket edge needs (regression: a v1 minimap edge-drag that overshot the opposite edge got
 * permanently stuck at `[t, t + MIN_SPAN_YEARS]`, unresponsive to further dragging).
 */
export function resizeWindowEdge(anchor: GeoTime, pointerT: GeoTime): TimeWindow {
  const clampedAnchor = clamp(anchor, 0, EARTH_FORMATION)
  const clampedPointer = clamp(pointerT, 0, EARTH_FORMATION)
  const newest = Math.min(clampedAnchor, clampedPointer)
  const oldest = Math.max(clampedAnchor, clampedPointer)
  if (oldest - newest >= MIN_SPAN_YEARS) return [newest, oldest]
  // Enforce the minimum span by pushing the *moving* edge away from the anchor rather than
  // clamping both edges independently — the anchor itself never moves, so a drag that is
  // currently within MIN_SPAN_YEARS of it keeps tracking the anchor's side of the cursor
  // rather than snapping to an arbitrary point.
  return clampedPointer >= clampedAnchor
    ? clampWindow(clampedAnchor, clampedAnchor + MIN_SPAN_YEARS)
    : clampWindow(clampedAnchor - MIN_SPAN_YEARS, clampedAnchor)
}
