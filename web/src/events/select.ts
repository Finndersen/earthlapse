/**
 * Pure selection for the event feed — the roadmap's "non-intrusive playback pop-up cards"
 * (approved-roadmap-2026-09) and "event card (description + citation)", surfacing events as
 * the playhead reaches them instead of requiring a hover over the timeline.
 *
 * Pure in `t` alone — no timers, no stored history, no scrub-direction bookkeeping. "Behind the
 * playhead" is defined chronologically, not by which way the caller is scrubbing: an event is a
 * candidate once its placement has been reached on the forward march from deep time toward the
 * present (`placementT(event) >= t`) and sits within `maxAgeRatio` times as old as `t` itself.
 * Because the test is `placementT(event) >= t` and a relative-age bound, revisiting the exact
 * same `t` from either scrub direction, or landing on it via a jump, reproduces the exact same
 * feed.
 */

import type { GeoTime, TimelineEvent } from '@/types/layer'

import { placementT } from './placement'

/** An event drops out once it is more than this many times older than the playhead (with
 *  `RECENCY_FLOOR_YEARS` added to both, so the present itself has a small window): standing 200
 *  years ago the feed reaches back to ~425 years ago, not to the Neolithic. */
export const DEFAULT_MAX_AGE_RATIO = 2

export const RECENCY_FLOOR_YEARS = 25

/** The most cards the feed ever shows: the compact single-card strip aside, three is what the
 *  slot between the layer readouts and the scene caption reads as "what just happened" rather
 *  than a scrolling log. */
export const DEFAULT_MAX_VISIBLE = 3

export interface FeedEntry {
  event: TimelineEvent
  /** 0 = just reached (freshest), 1 = at the edge of the age window, about to drop out. */
  distanceFraction: number
}

export interface FeedSelection {
  /** Freshest first (`distanceFraction` ascending, ties by importance then id). Capped at
   *  `maxVisible`. */
  visible: FeedEntry[]
}

const EMPTY_SELECTION: FeedSelection = { visible: [] }

export interface SelectFeedEventsOptions {
  maxAgeRatio?: number
  maxVisible?: number
}

/**
 * Every event behind `t` within `maxAgeRatio`, freshest first, capped at `maxVisible`.
 * `maxAgeRatio <= 1` returns nothing rather than dividing by zero.
 */
export function selectFeedEvents(
  events: readonly TimelineEvent[],
  t: GeoTime,
  options: SelectFeedEventsOptions = {},
): FeedSelection {
  const { maxAgeRatio = DEFAULT_MAX_AGE_RATIO, maxVisible = DEFAULT_MAX_VISIBLE } = options
  if (maxAgeRatio <= 1) return EMPTY_SELECTION

  const logMaxAgeRatio = Math.log(maxAgeRatio)

  const candidates: FeedEntry[] = []
  for (const event of events) {
    const eventT = placementT(event)
    if (eventT < t) continue // ahead of t: hasn't happened yet from this vantage
    const distanceFraction = Math.log((eventT + RECENCY_FLOOR_YEARS) / (t + RECENCY_FLOOR_YEARS)) / logMaxAgeRatio
    if (distanceFraction > 1) continue
    candidates.push({ event, distanceFraction })
  }

  candidates.sort((a, b) => {
    if (a.distanceFraction !== b.distanceFraction) return a.distanceFraction - b.distanceFraction
    if (a.event.importance !== b.event.importance) return b.event.importance - a.event.importance
    return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0
  })

  if (maxVisible <= 0) return { visible: [] }
  return { visible: candidates.slice(0, maxVisible) }
}
