/**
 * Pure selection for the event feed — the roadmap's "non-intrusive playback pop-up cards"
 * (approved-roadmap-2026-09) and "event card (description + citation)", surfacing events as
 * the playhead reaches them instead of requiring a hover over the timeline.
 *
 * The rule is "the most recent `maxVisible` events at or before `t`": a card leaves because a
 * newer event pushed it off the end, not because the playhead drifted on. `lookbackAgeRatio` is
 * an outer sanity limit an order of magnitude beyond the freshness scale, not the thing that
 * evicts cards — a half-full feed keeps what it has until there is something newer to replace
 * it with.
 *
 * Pure in `t` alone — no timers, no stored history, no scrub-direction bookkeeping. "Behind the
 * playhead" is defined chronologically, not by which way the caller is scrubbing: an event is a
 * candidate once its placement has been reached on the forward march from deep time toward the
 * present (`placementT(event) >= t`). So revisiting the exact same `t` from either scrub
 * direction, or landing on it via a jump, reproduces the exact same feed.
 */

import type { GeoTime, TimelineEvent } from '@/types/layer'

import { placementT } from './placement'

/** How far behind the playhead the feed will reach for a card, as a multiple of the playhead's
 *  own age (with `RECENCY_FLOOR_YEARS` added to both, so the present itself has a window): an
 *  event an order of magnitude older than `t` is no longer "what just happened" at any event
 *  density, so standing 200 years ago the feed will not reach back to the Neolithic even if the
 *  intervening centuries were empty. `maxVisible` is what ordinarily ends a card's time on
 *  screen; this only stops the feed scraping the bottom of a sparse era. */
export const DEFAULT_LOOKBACK_AGE_RATIO = 10

/** The reference scale for `FeedEntry.distanceFraction`: an event sits at 1 once it is twice as
 *  old as the playhead. Presentation only — it sets how quickly a card's arrival emphasis and
 *  opacity settle, and has no say in whether the card is shown. */
export const FRESH_AGE_RATIO = 2

export const RECENCY_FLOOR_YEARS = 25

/** The most cards the feed ever shows: the compact single-card strip aside, three is what the
 *  slot between the layer readouts and the scene caption reads as "what just happened" rather
 *  than a scrolling log. */
export const DEFAULT_MAX_VISIBLE = 3

export interface FeedEntry {
  event: TimelineEvent
  /** Relative age behind the playhead on the `FRESH_AGE_RATIO` scale: 0 = just reached
   *  (freshest), 1 = twice as old as the playhead. Unbounded above — a card is free to recede
   *  well past 1 while it remains among the most recent events. */
  distanceFraction: number
}

export interface FeedSelection {
  /** Freshest first (`distanceFraction` ascending, ties by importance then id). Capped at
   *  `maxVisible`. */
  visible: FeedEntry[]
}

const EMPTY_SELECTION: FeedSelection = { visible: [] }

export interface SelectFeedEventsOptions {
  lookbackAgeRatio?: number
  maxVisible?: number
}

/**
 * The `maxVisible` most recent events at or before `t`, freshest first, reaching back at most
 * `lookbackAgeRatio` times the playhead's own age. `lookbackAgeRatio <= 1` returns nothing
 * rather than admitting only events exactly at `t`.
 */
export function selectFeedEvents(
  events: readonly TimelineEvent[],
  t: GeoTime,
  options: SelectFeedEventsOptions = {},
): FeedSelection {
  const { lookbackAgeRatio = DEFAULT_LOOKBACK_AGE_RATIO, maxVisible = DEFAULT_MAX_VISIBLE } = options
  if (lookbackAgeRatio <= 1 || maxVisible <= 0) return EMPTY_SELECTION

  const logFreshAgeRatio = Math.log(FRESH_AGE_RATIO)

  const candidates: FeedEntry[] = []
  for (const event of events) {
    const eventT = placementT(event)
    if (eventT < t) continue // ahead of t: hasn't happened yet from this vantage
    const ageRatio = (eventT + RECENCY_FLOOR_YEARS) / (t + RECENCY_FLOOR_YEARS)
    if (ageRatio > lookbackAgeRatio) continue
    candidates.push({ event, distanceFraction: Math.log(ageRatio) / logFreshAgeRatio })
  }

  candidates.sort((a, b) => {
    if (a.distanceFraction !== b.distanceFraction) return a.distanceFraction - b.distanceFraction
    if (a.event.importance !== b.event.importance) return b.event.importance - a.event.importance
    return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0
  })

  return { visible: candidates.slice(0, maxVisible) }
}
