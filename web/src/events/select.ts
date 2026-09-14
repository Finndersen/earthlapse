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

/** Default lookback, in displayed track pixels — how far behind the playhead's own position
 *  an event's placement may sit and still show. Tuned against the real manifest's Holocene
 *  stretch (agriculture, writing, spaceflight sit a few displayed px apart at full zoom-out;
 *  this comfortably spans several of them without reaching all the way back to, say, the
 *  Neolithic) and its sparsest deep-time stretch (a single lookback window can span tens of
 *  millions of years there, which is the point — the window is defined in screen space, not
 *  years, exactly so both regimes work from the same constant). */
export const DEFAULT_LOOKBACK_PX = 220

/** Cards shown before the rest collapse into a "+k more" line, at rest (a narrow viewport
 *  shows fewer still — see `useIsCompactViewport`, consumed by `<EventFeed>`). Kept small
 *  deliberately: the feed lives in a fixed, non-intrusive HUD slot (`EventFeed.module.css`'s
 *  own height cap, sized to fit under the layer readouts without touching them) rather than
 *  one that grows with content, so this is tuned to what that slot actually fits alongside the
 *  "+k more" line, not an arbitrary round number. */
export const DEFAULT_MAX_VISIBLE = 2

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
  maxVisible?: number
  /** Event ids to skip outright — `<EventFeed>` passes the ids the currently-captioned scene
   *  already names (`Scene.events`, ADR-022) here, via `sceneCaptionedEventIds`, so the feed
   *  never repeats what the caption already says. */
  excludedEventIds?: ReadonlySet<string>
}

/**
 * Every event behind `t` within `lookbackPx`, freshest first, capped at `maxVisible`.
 * `trackWidthPx <= 0` (not yet measured) or `lookbackPx <= 0` returns nothing rather than
 * dividing by zero or treating every event as infinitely close.
 */
export function selectFeedEvents(
  events: readonly TimelineEvent[],
  t: GeoTime,
  scale: TimeScale,
  trackWidthPx: number,
  options: SelectFeedEventsOptions = {},
): FeedSelection {
  const { lookbackPx = DEFAULT_LOOKBACK_PX, maxVisible = DEFAULT_MAX_VISIBLE, excludedEventIds } = options
  if (trackWidthPx <= 0 || lookbackPx <= 0) return EMPTY_SELECTION

  const playheadU = scale.toUnit(t)

  const candidates: FeedEntry[] = []
  for (const event of events) {
    if (excludedEventIds?.has(event.id)) continue
    const eventT = placementT(event)
    if (eventT < t) continue // ahead of t: hasn't happened yet from this vantage
    const distancePx = Math.abs(playheadU - scale.toUnit(eventT)) * trackWidthPx
    if (distancePx > lookbackPx) continue
    candidates.push({ event, distanceFraction: distancePx / lookbackPx })
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

/** A card's opacity at `distanceFraction` (0 fresh -> 1 about to fall out of range): eased
 *  rather than linear, so a card reads clearly for most of its time in the window and only
 *  dims sharply right at the edge, instead of visibly fading from the moment it appears. */
export function feedCardOpacity(distanceFraction: number): number {
  const clamped = Math.min(1, Math.max(0, distanceFraction))
  return 1 - clamped * clamped
}

/** Cosmetic drift, in px, so a receding card visibly settles rather than only dimming in
 *  place — purely presentational, not part of the selection contract above. */
export const MAX_CARD_OFFSET_PX = 10

export function feedCardOffsetPx(distanceFraction: number): number {
  const clamped = Math.min(1, Math.max(0, distanceFraction))
  return clamped * MAX_CARD_OFFSET_PX
}
