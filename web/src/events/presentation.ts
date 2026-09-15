/**
 * How `<EventFeed>`'s cards look, and how many of them its slot has room for — the
 * presentational half of the feed, kept apart from `select.ts`'s selection contract.
 *
 * Every function here is pure: a function of a card's `distanceFraction` / rank in the
 * selection, or of the slot's measured height, never of wall-clock time. So scrubbing back to a
 * `t` reproduces the same emphasis as well as the same cards, and fast playback can't leave a
 * highlight "stuck on" or flash it off early — CSS transitions only animate *between* the states
 * these functions describe.
 */

import type { FeedEntry } from './select'

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Collapsed card geometry, in px. The single source of truth for both `feedCardCapacity` and
 *  the stylesheet: `<EventFeed>` pushes these into CSS custom properties, so the capacity
 *  arithmetic can't drift from what `EventFeed.module.css` actually draws. The card height is
 *  its border + padding + one title line + one description line (`EventFeed.module.css`). */
export const FEED_CARD_HEIGHT_PX = 52
export const FEED_CARD_GAP_PX = 6
/** The "+k more" line, plus the gap above it — always reserved, so a feed that grows an
 *  overflow line never pushes its bottom card out of the slot. */
export const FEED_OVERFLOW_LINE_PX = 20

/**
 * How many collapsed cards fit in `availableHeightPx` alongside a "+k more" line, capped at
 * `maxVisible`. Never below 1: a slot squeezed shorter than one card (a very short window, an
 * open chart dock) still shows the freshest event, scrolling within the slot rather than
 * dropping the feed entirely.
 */
export function feedCardCapacity(availableHeightPx: number, maxVisible: number): number {
  const fits = Math.floor((availableHeightPx - FEED_OVERFLOW_LINE_PX) / (FEED_CARD_HEIGHT_PX + FEED_CARD_GAP_PX))
  return Math.max(1, Math.min(maxVisible, fits))
}

/** The phone's collapsed one-line strip, in px: border + padding + one title line
 *  (`EventFeed.module.css`'s compact block draws it at exactly this height). */
export const FEED_STRIP_HEIGHT_PX = 33

/**
 * Whether the phone's one-line strip fits in `availableHeightPx`: 1 card or none. Unlike the
 * desktop stack, the strip cannot scroll inside a squeezed slot. Drawn anyway, it would spill
 * over the layer readouts above, so a row shorter than the strip shows nothing.
 */
export function feedStripCapacity(availableHeightPx: number): 0 | 1 {
  return availableHeightPx >= FEED_STRIP_HEIGHT_PX ? 1 : 0
}

/** A card's opacity at `distanceFraction` (0 fresh -> 1 about to fall out of range): eased
 *  rather than linear, so a card reads clearly for most of its time in the window and only
 *  dims sharply right at the edge, instead of visibly fading from the moment it appears. */
export function feedCardOpacity(distanceFraction: number): number {
  const clamped = clampUnit(distanceFraction)
  return 1 - clamped * clamped
}

/** Cosmetic drift, in px, so a receding card visibly settles rather than only dimming in
 *  place. */
export const MAX_CARD_OFFSET_PX = 10

export function feedCardOffsetPx(distanceFraction: number): number {
  return clampUnit(distanceFraction) * MAX_CARD_OFFSET_PX
}

/** The share of the lookback window over which a just-reached card's emphasis eases away. A
 *  band, not a threshold, so the highlight settles as the card recedes instead of switching
 *  off at some instant. */
export const FRESH_EMPHASIS_BAND = 0.35

/**
 * Per-card "just reached" emphasis in [0, 1], aligned with `visible`: only the freshest card
 * (`visible[0]`) is ever emphasised — 1 as the playhead reaches it, smoothstepping to 0 across
 * `FRESH_EMPHASIS_BAND` — and every other card is 0. One emphasised card at most is what keeps
 * fast playback through a dense stretch from strobing: the highlight hands over to each newly
 * reached event rather than several cards lighting and dimming at once.
 */
export function feedCardEmphases(visible: readonly FeedEntry[]): number[] {
  return visible.map((entry, rank) => (rank === 0 ? freshnessEmphasis(entry.distanceFraction) : 0))
}

function freshnessEmphasis(distanceFraction: number): number {
  const remaining = 1 - clampUnit(distanceFraction / FRESH_EMPHASIS_BAND)
  return remaining * remaining * (3 - 2 * remaining)
}

/** How far, in px, an emphasised card's text sits inset from its resting position, making
 *  room for the accent bar and settling back as the emphasis fades. */
export const MAX_FRESH_INSET_PX = 5

export function feedCardInsetPx(emphasis: number): number {
  return clampUnit(emphasis) * MAX_FRESH_INSET_PX
}
