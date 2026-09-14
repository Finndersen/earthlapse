/** Level of detail for event markers (DESIGN §3: "a 1D quadtree — the same idea as map tile
 *  LOD"). A visible span in years maps to a minimum `TimelineEvent.importance`; only events
 *  at or above that threshold, and overlapping the visible window, are drawn. */

import type { GeoTime, TimelineEvent } from '@/types/layer'
import { EARTH_FORMATION } from '@/types/layer'

import type { TimeWindow } from './scale'
import { MIN_SPAN_YEARS } from './zoom'
import { clamp } from './util'

const LOG_MIN_SPAN = Math.log10(MIN_SPAN_YEARS)
const LOG_MAX_SPAN = Math.log10(EARTH_FORMATION)

/**
 * Monotone in `spanYears`: a wider visible span raises the importance floor, so only the
 * highest-importance events (the "Big Five" extinctions, the origin of life) survive at full
 * zoom-out, while a 1-year span shows everything. The threshold is log-linear in the span —
 * matching the symlog time axis itself — so zooming in feels like a steady reveal rather than
 * a sudden dump of markers partway through.
 */
export function minImportanceForSpan(spanYears: number): number {
  const span = clamp(spanYears, MIN_SPAN_YEARS, EARTH_FORMATION)
  const logSpan = Math.log10(span)
  return clamp((logSpan - LOG_MIN_SPAN) / (LOG_MAX_SPAN - LOG_MIN_SPAN), 0, 1)
}

/**
 * `minImportanceForSpan`, but for a point inside the fisheye lens (ADR-017): `magnification`
 * (displayed px per undistorted px at that point, 1 with no lens) shrinks the effective span
 * the LOD threshold is computed from, so a stretched part of the track reveals the same detail
 * a genuinely narrower span would — the whole point of the lens is to make room for that detail
 * on screen, and the LOD floor should stop hiding it once there is room.
 */
export function minImportanceAt(spanYears: number, magnification: number): number {
  return minImportanceForSpan(spanYears / Math.max(1, magnification))
}

/**
 * Events whose uncertainty band `[tMin, tMax]` overlaps `window` and whose `importance` clears
 * `minImportanceForSpan(spanYears)`. `spanYears` is taken as a parameter rather than derived
 * from `window` because the caller may be mid-zoom-animation, where the LOD threshold should
 * track the animated span, not just the window's own width.
 */
export function visibleEvents(
  events: readonly TimelineEvent[],
  window: TimeWindow,
  spanYears: number,
): TimelineEvent[] {
  const [newest, oldest] = window
  const threshold = minImportanceForSpan(spanYears)
  return events.filter((e) => e.importance >= threshold && overlaps(e, newest, oldest))
}

function overlaps(e: TimelineEvent, newest: GeoTime, oldest: GeoTime): boolean {
  return e.tMax >= newest && e.tMin <= oldest
}

export type EventStepDirection = 'back' | 'forward'

/**
 * The nearest currently-visible event in `direction` from `t` — `'back'` being further into
 * the past (screen-left), `'forward'` toward the present (screen-right), matching the
 * package's left-to-right-is-past-to-present orientation. `undefined` when there is no such
 * event (e.g. `t` already sits at the oldest/newest visible one). Shared by the transport's
 * step buttons and the keyboard shortcut (README §2: "←/→ step to the previous/next event")
 * so both agree on what "next event" means.
 */
export function nearestNeighbourEvent(
  events: readonly TimelineEvent[],
  window: TimeWindow,
  spanYears: number,
  t: GeoTime,
  direction: EventStepDirection,
): TimelineEvent | undefined {
  const shown = visibleEvents(events, window, spanYears)
  const candidates = direction === 'back' ? shown.filter((e) => e.tMin > t) : shown.filter((e) => e.tMax < t)
  if (candidates.length === 0) return undefined
  return direction === 'back'
    ? candidates.reduce((a, b) => (a.tMin < b.tMin ? a : b))
    : candidates.reduce((a, b) => (a.tMax > b.tMax ? a : b))
}
