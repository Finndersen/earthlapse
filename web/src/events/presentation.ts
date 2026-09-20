/**
 * How `<EventFeed>`'s cards look — the presentational half of the feed, kept apart from
 * `select.ts`'s selection contract.
 *
 * Every function here is pure: a function of a card's `distanceFraction` or rank in the
 * selection, never of wall-clock time. So scrubbing back to a `t` reproduces the same emphasis
 * as well as the same cards, and fast playback can't leave a highlight "stuck on" or flash it
 * off early — CSS transitions only animate *between* the states these functions describe.
 *
 * `distanceFraction` is a freshness measure, not a countdown to eviction (`select.ts` evicts by
 * rank), so nothing here may drive a card to the point of being unreadable.
 */

import type { FeedEntry } from './select'

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** Collapsed card geometry, in px — the single source of truth for the stylesheet:
 *  `<EventFeed>` pushes these into CSS custom properties, so `EventFeed.module.css` can't drift
 *  from what this file describes. The card height is its border + padding + one title line +
 *  one description line (`EventFeed.module.css`). */
export const FEED_CARD_HEIGHT_PX = 52
export const FEED_CARD_GAP_PX = 6

/** The phone's collapsed one-line strip, in px: border + padding + one title line
 *  (`EventFeed.module.css`'s compact block draws it at exactly this height). */
export const FEED_STRIP_HEIGHT_PX = 33

/** The dimmest a card ever gets. A card leaves the feed when a newer event pushes it off the
 *  end, not by ageing out, so opacity cannot run to zero: the oldest card on screen may still
 *  be the most recent thing that has happened, and has to stay readable over the scene behind
 *  it. */
export const MIN_CARD_OPACITY = 0.6

/** A card's opacity at `distanceFraction` (0 fresh -> 1 twice as old as the playhead): eased
 *  rather than linear, so a card reads at full strength for most of the freshness scale and
 *  settles to `MIN_CARD_OPACITY` beyond it, instead of visibly fading from the moment it
 *  appears. */
export function feedCardOpacity(distanceFraction: number): number {
  const clamped = clampUnit(distanceFraction)
  return 1 - (1 - MIN_CARD_OPACITY) * clamped * clamped
}

/** The share of the freshness scale over which a just-reached card's emphasis eases away. A
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
