/**
 * Pure selection for the event feed — the roadmap's "non-intrusive playback pop-up cards"
 * (approved-roadmap-2026-09) and "event card (description + citation)", surfacing events as
 * the playhead reaches them instead of requiring a hover over the timeline.
 *
 * The unit of selection is the *cluster* (`cluster.ts`), not the raw event (ADR-040): the rule
 * is "the most recent `maxVisible` clusters with a reached member at or before `t`". A cluster
 * occupies one feed slot regardless of how many of its members have been reached, so a burst of
 * near-simultaneous events grows one digest card instead of evicting itself. A slot leaves
 * because a newer cluster pushed it off the end, not because the playhead drifted on.
 * `lookbackAgeRatio` is an outer sanity limit an order of magnitude beyond the freshness scale,
 * not the thing that evicts cards, and it still applies per event: a member of a cluster can age
 * out of the lookback window (and so out of that cluster's digest) independently of its
 * clustermates, exactly as a lone event always has.
 *
 * Pure in `t` alone — no timers, no stored history, no scrub-direction bookkeeping. "Behind the
 * playhead" is defined chronologically, not by which way the caller is scrubbing: an event is a
 * candidate once its placement has been reached on the forward march from deep time toward the
 * present (`placementT(event) >= t`). So revisiting the exact same `t` from either scrub
 * direction, or landing on it via a jump, reproduces the exact same feed.
 */

import type { GeoTime, TimelineEvent } from '@/types/layer'

import { clusterEvents, RECENCY_FLOOR_YEARS } from './cluster'
import { placementT } from './placement'

export { RECENCY_FLOOR_YEARS }

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

/** The most cards the feed ever shows: the compact single-card strip aside, three is what the
 *  slot between the layer readouts and the scene caption reads as "what just happened" rather
 *  than a scrolling log. */
export const DEFAULT_MAX_VISIBLE = 3

export interface FeedEntry {
  /** The cluster's freshest reached member — what the card's headline renders. */
  event: TimelineEvent
  /** Relative age behind the playhead on the `FRESH_AGE_RATIO` scale: 0 = just reached
   *  (freshest), 1 = twice as old as the playhead. Unbounded above — a card is free to recede
   *  well past 1 while it remains among the most recent clusters. Computed from `event` alone. */
  distanceFraction: number
  /** Every member of this card's cluster reached so far (at or before `t`, within
   *  `lookbackAgeRatio`), freshest first — `event` is always `members[0]`. Length 1 for a
   *  cluster with only one member reached, which is every cluster's own starting state and,
   *  for a cluster that never gains a second member, its state throughout. */
  members: readonly TimelineEvent[]
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
 * The `maxVisible` most recent clusters with a reached member at or before `t`, freshest first,
 * reaching back at most `lookbackAgeRatio` times the playhead's own age. `lookbackAgeRatio <= 1`
 * returns nothing rather than admitting only events exactly at `t`.
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
  for (const cluster of clusterEvents(events)) {
    // `cluster.members` is already freshest-first, so filtering in that order leaves `reached`
    // freshest-first too — the same "ahead of t" / "beyond the lookback" gates this module has
    // always applied, just walked per cluster instead of per event.
    const reached: TimelineEvent[] = []
    for (const event of cluster.members) {
      const eventT = placementT(event)
      if (eventT < t) continue // ahead of t: hasn't happened yet from this vantage
      const ageRatio = (eventT + RECENCY_FLOOR_YEARS) / (t + RECENCY_FLOOR_YEARS)
      if (ageRatio > lookbackAgeRatio) continue
      reached.push(event)
    }
    if (reached.length === 0) continue

    const headline = reached[0]!
    const headlineAgeRatio = (placementT(headline) + RECENCY_FLOOR_YEARS) / (t + RECENCY_FLOOR_YEARS)
    candidates.push({
      event: headline,
      distanceFraction: Math.log(headlineAgeRatio) / logFreshAgeRatio,
      members: reached,
    })
  }

  candidates.sort((a, b) => {
    if (a.distanceFraction !== b.distanceFraction) return a.distanceFraction - b.distanceFraction
    if (a.event.importance !== b.event.importance) return b.event.importance - a.event.importance
    return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0
  })

  return { visible: candidates.slice(0, maxVisible) }
}
