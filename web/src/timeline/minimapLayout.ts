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
