/**
 * Pure pixel geometry for the overview minimap's visible-window bracket (README §"Overview
 * minimap"). Kept separate from the `Minimap` component so it is directly unit-testable
 * without mounting React or a real layout engine.
 */

import { EARTH_FORMATION } from '@/types/layer'

import { createSymlogScale, type TimeWindow } from './scale'
import { clamp } from './util'

/** The minimap is always symlog over the full domain — "same warp as the main track at full
 *  zoom-out" — regardless of the main track's own symlog/linear toggle. */
export const MINIMAP_FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]

/** The bracket never renders narrower than this, so a deeply-zoomed window (e.g. a single
 *  year) stays visible and grabbable on the overview strip instead of vanishing. */
export const MIN_BRACKET_PX = 8

export interface BracketLayout {
  /** Left edge in px from the track's own left edge. */
  leftPx: number
  widthPx: number
}

/** Above this fraction of the minimap's own full-domain symlog `u`-span, the bracket covers
 *  (nearly) the whole strip — there is no edge or body left to grab distinctly from the track
 *  itself, so `Minimap` falls back to brush-select (see `isBracketNearlyFullDomain`). Not 1.0:
 *  a window that is merely *very* wide (but not the literal full domain) has the identical
 *  "nothing to grab" problem once its bracket is within a pixel or two of the track's own
 *  edges. */
export const BRACKET_NEARLY_FULL_THRESHOLD = 0.985

/**
 * `window`'s span in the minimap's own full-domain symlog `u` — the same space
 * `minimapBracket` renders in — as a fraction of the full `[0, 1]` `u`-range. Used by `Minimap`
 * to decide when the bracket is (nearly) indistinguishable from the track itself.
 */
export function bracketUnitSpan(window: TimeWindow): number {
  const scale = createSymlogScale(MINIMAP_FULL_DOMAIN)
  return scale.toUnit(window[0]) - scale.toUnit(window[1])
}

/** Whether `window`'s bracket is (nearly) the full width of the minimap track — see
 *  `BRACKET_NEARLY_FULL_THRESHOLD`. */
export function isBracketNearlyFullDomain(window: TimeWindow): boolean {
  return bracketUnitSpan(window) >= BRACKET_NEARLY_FULL_THRESHOLD
}

/**
 * Pans `window` by `deltaU` — a fraction of the minimap *track's own pixel width*, in the
 * minimap's fixed full-domain symlog `u`-space (not the window's own local warp; contrast
 * `zoom.ts`'s `panWindow`, which is for the main scrub track panning *itself*, a fundamentally
 * different gesture — see that function's doc comment). Both bracket edges shift by the exact
 * same `deltaU`, so the bracket's rendered pixel width (and hence its `u`-span) stays exactly
 * constant and it tracks the pointer 1:1, matching how a person expects to drag a box: the
 * point under the cursor at drag-start stays under the cursor for the rest of the drag.
 *
 * (Regression this replaces: panning used to shift both raw-year bounds by a single delta
 * computed by converting pixel positions through the symlog warp and back to years — which,
 * because that warp is nonlinear, does not correspond to a constant `u`-shift. The rendered
 * bracket therefore changed width mid-drag and drifted away from the cursor instead of
 * tracking it.)
 *
 * Clamped to the full domain by sliding (not shrinking) the bracket when an edge would leave
 * `[0, 1]` in `u`-space, the same "slide, don't shrink" rule `clampWindowToDomain` applies in
 * raw-year space elsewhere in this package.
 */
export function panBracket(window: TimeWindow, deltaU: number): TimeWindow {
  const scale = createSymlogScale(MINIMAP_FULL_DOMAIN)
  // Same orientation as `minimapBracket`: `u = 0` at the OLDEST edge (left), `u = 1` at the
  // NEWEST edge (right) — so `leftU < rightU` and the span below is `rightU - leftU`.
  const leftU = scale.toUnit(window[1]) // oldest bound
  const rightU = scale.toUnit(window[0]) // newest bound
  const span = rightU - leftU

  let shiftedLeftU = leftU + deltaU
  let shiftedRightU = rightU + deltaU
  if (shiftedLeftU < 0) {
    shiftedLeftU = 0
    shiftedRightU = span
  }
  if (shiftedRightU > 1) {
    shiftedRightU = 1
    shiftedLeftU = 1 - span
  }

  return [scale.fromUnit(shiftedRightU), scale.fromUnit(shiftedLeftU)]
}

/**
 * Where `window`'s bracket sits on a minimap track `trackWidthPx` wide, in the full-domain
 * symlog warp. Below `MIN_BRACKET_PX` of true width, the bracket is widened to that floor
 * and re-centred on the window's true (un-widened) midpoint, clamped so it never renders
 * outside the track itself.
 */
export function minimapBracket(window: TimeWindow, trackWidthPx: number): BracketLayout {
  if (!(trackWidthPx > 0)) return { leftPx: 0, widthPx: 0 }

  const scale = createSymlogScale(MINIMAP_FULL_DOMAIN)
  const startU = scale.toUnit(window[1]) // oldest edge — left
  const endU = scale.toUnit(window[0]) // newest edge — right

  const trueLeftPx = startU * trackWidthPx
  const trueWidthPx = Math.max(0, (endU - startU) * trackWidthPx)

  if (trueWidthPx >= MIN_BRACKET_PX) return { leftPx: trueLeftPx, widthPx: trueWidthPx }

  const centerPx = trueLeftPx + trueWidthPx / 2
  const leftPx = clamp(centerPx - MIN_BRACKET_PX / 2, 0, Math.max(0, trackWidthPx - MIN_BRACKET_PX))
  return { leftPx, widthPx: MIN_BRACKET_PX }
}
