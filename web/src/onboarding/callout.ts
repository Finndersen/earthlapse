/**
 * Where a step's callout card sits relative to the control it points at. Pure geometry — no DOM,
 * no React — so the case that actually decides the design is directly testable at any size: a
 * phone viewport is short and narrow, so a card usually cannot sit beside its target and has to
 * go above or below it, and near the middle of a short screen it may not fit cleanly on any side
 * at all.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export type CalloutSide = 'above' | 'below' | 'left' | 'right'

export interface Callout {
  side: CalloutSide
  /** Viewport coordinates for the card's top-left corner, already clamped on screen. */
  left: number
  top: number
}

/** Clearance between the card and the control it points at — enough that the highlight ring
 *  reads as separate from the card rather than as its border. */
const GAP_PX = 14

/** Smallest distance the card ever sits from a viewport edge. */
const MARGIN_PX = 12

/** Tried in this order, so a card lands under its target where there is room and above it where
 *  there is not — the phone case — before ever being considered beside it. */
const SIDE_PREFERENCE: readonly CalloutSide[] = ['below', 'above', 'right', 'left']

function freeSpaceOn(side: CalloutSide, anchor: Rect, viewport: Size): number {
  switch (side) {
    case 'above':
      return anchor.y
    case 'below':
      return viewport.height - (anchor.y + anchor.height)
    case 'left':
      return anchor.x
    case 'right':
      return viewport.width - (anchor.x + anchor.width)
  }
}

function cardExtentOn(side: CalloutSide, card: Size): number {
  return side === 'above' || side === 'below' ? card.height : card.width
}

function slackOn(side: CalloutSide, anchor: Rect, card: Size, viewport: Size): number {
  return freeSpaceOn(side, anchor, viewport) - cardExtentOn(side, card) - GAP_PX - MARGIN_PX
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function placeCallout(anchor: Rect, card: Size, viewport: Size): Callout {
  const side =
    SIDE_PREFERENCE.find((candidate) => slackOn(candidate, anchor, card, viewport) >= 0) ??
    // The card fits cleanly on no side — a target near the middle of a short viewport. Take
    // whichever side comes closest and let the clamp below keep the card on screen, overlapping
    // its target rather than running off the edge.
    SIDE_PREFERENCE.reduce((best, candidate) =>
      slackOn(candidate, anchor, card, viewport) > slackOn(best, anchor, card, viewport) ? candidate : best,
    )

  const maxLeft = Math.max(MARGIN_PX, viewport.width - card.width - MARGIN_PX)
  const maxTop = Math.max(MARGIN_PX, viewport.height - card.height - MARGIN_PX)

  if (side === 'above' || side === 'below') {
    const top = side === 'below' ? anchor.y + anchor.height + GAP_PX : anchor.y - card.height - GAP_PX
    const centredLeft = anchor.x + anchor.width / 2 - card.width / 2
    return { side, left: clamp(centredLeft, MARGIN_PX, maxLeft), top: clamp(top, MARGIN_PX, maxTop) }
  }

  const left = side === 'right' ? anchor.x + anchor.width + GAP_PX : anchor.x - card.width - GAP_PX
  const centredTop = anchor.y + anchor.height / 2 - card.height / 2
  return { side, left: clamp(left, MARGIN_PX, maxLeft), top: clamp(centredTop, MARGIN_PX, maxTop) }
}
