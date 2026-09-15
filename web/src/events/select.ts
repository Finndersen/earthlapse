/**
 * Pure selection for the event feed — the roadmap's "non-intrusive playback pop-up cards"
 * (approved-roadmap-2026-09) and "event card (description + citation)", surfacing events as
 * the playhead reaches them instead of requiring a hover over the timeline.
 *
 * Pure in `t` plus the current display-space scale and track width only — no timers, no
 * stored history, no scrub-direction bookkeeping. "Behind the playhead" is defined
 * chronologically, not by which way the caller is scrubbing: an event is a candidate once its
 * placement has been reached on the forward march from deep time toward the present
 * (`placementT(event) >= t`) and sits within `lookbackPx` of `t`'s own position on `scale`,
 * measured in *displayed* pixels rather than raw years so the window adapts to how compressed
 * or expanded the local stretch of the (symlog) axis currently reads — a few years wide in the
 * dense Holocene, hundreds of millions of years wide in sparse deep time. Because the test is
 * `placementT(event) >= t` and a displayed-distance bound, revisiting the exact same `t` from
 * either scrub direction, or landing on it via a jump, reproduces the exact same feed.
 */

import type { GeoTime, TimeScale, TimelineEvent } from '@/types/layer'

import { placementT } from './placement'

/** Default lookback, in pixels of `scale` across `trackWidthPx` — how far behind the playhead's
 *  own position an event's placement may sit and still show. `Experience` passes the full-domain
 *  symlog scale, not the timeline's section window: measured on a zoomed-in section, 220px of a
 *  154-year Industrial age is a few decades and the feed goes empty (ADR-024). On its own it is
 *  not enough: the symlog axis is nearly
 *  linear below its ~10 kyr knee, so at full-domain view the whole of human history fits in a
 *  few dozen pixels and any useful pixel window sweeps all of it ("+55 more" at 200 years ago).
 *  `DEFAULT_MAX_AGE_RATIO` bounds that case. */
export const DEFAULT_LOOKBACK_PX = 220

/** An event also drops out once it is more than this many times older than the playhead
 *  (with `RECENCY_FLOOR_YEARS` added to both, so the present itself has a small window):
 *  standing 200 years ago the feed reaches back to ~425 years ago, not to the Neolithic. */
export const DEFAULT_MAX_AGE_RATIO = 2

export const RECENCY_FLOOR_YEARS = 25

/** The most cards shown before the rest collapse into a "+k more" line. `<EventFeed>` shows
 *  fewer when its HUD slot is shorter than that many cards (`feedCardCapacity`, from the slot's
 *  measured height) and a single card on a narrow viewport (`useIsCompactViewport`). Four is
 *  the most the slot between the layer readouts and the scene caption fits at 1440x900 (3-4
 *  depending on caption length; 1280x720 fits one); past four the feed stops reading as "what
 *  just happened". */
export const DEFAULT_MAX_VISIBLE = 4

export interface FeedEntry {
  event: TimelineEvent
  /** 0 = just reached (freshest), 1 = at the edge of the lookback window, about to drop out. */
  distanceFraction: number
}

export interface FeedSelection {
  /** Freshest first (`distanceFraction` ascending, ties by importance then id). Capped at
   *  `maxVisible`. */
  visible: FeedEntry[]
  /** Further candidates beyond the cap, same ordering — not dropped, just not drawn as cards. */
  overflowCount: number
}

const EMPTY_SELECTION: FeedSelection = { visible: [], overflowCount: 0 }

export interface SelectFeedEventsOptions {
  lookbackPx?: number
  maxAgeRatio?: number
  maxVisible?: number
}

/**
 * Every event behind `t` within both `lookbackPx` and `maxAgeRatio`, freshest first, capped at
 * `maxVisible`. `distanceFraction` is the larger of the two fractions, so a card fades toward
 * whichever bound it will cross first. `trackWidthPx <= 0` (not yet measured), `lookbackPx <= 0`
 * or `maxAgeRatio <= 1` returns nothing rather than dividing by zero.
 */
export function selectFeedEvents(
  events: readonly TimelineEvent[],
  t: GeoTime,
  scale: TimeScale,
  trackWidthPx: number,
  options: SelectFeedEventsOptions = {},
): FeedSelection {
  const {
    lookbackPx = DEFAULT_LOOKBACK_PX,
    maxAgeRatio = DEFAULT_MAX_AGE_RATIO,
    maxVisible = DEFAULT_MAX_VISIBLE,
  } = options
  if (trackWidthPx <= 0 || lookbackPx <= 0 || maxAgeRatio <= 1) return EMPTY_SELECTION

  const playheadU = scale.toUnit(t)
  const logMaxAgeRatio = Math.log(maxAgeRatio)

  const candidates: FeedEntry[] = []
  for (const event of events) {
    const eventT = placementT(event)
    if (eventT < t) continue // ahead of t: hasn't happened yet from this vantage
    const pxFraction = (Math.abs(playheadU - scale.toUnit(eventT)) * trackWidthPx) / lookbackPx
    const ageFraction = Math.log((eventT + RECENCY_FLOOR_YEARS) / (t + RECENCY_FLOOR_YEARS)) / logMaxAgeRatio
    const distanceFraction = Math.max(pxFraction, ageFraction)
    if (distanceFraction > 1) continue
    candidates.push({ event, distanceFraction })
  }

  candidates.sort((a, b) => {
    if (a.distanceFraction !== b.distanceFraction) return a.distanceFraction - b.distanceFraction
    if (a.event.importance !== b.event.importance) return b.event.importance - a.event.importance
    return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0
  })

  if (maxVisible <= 0) return { visible: [], overflowCount: candidates.length }
  return {
    visible: candidates.slice(0, maxVisible),
    overflowCount: Math.max(0, candidates.length - maxVisible),
  }
}
