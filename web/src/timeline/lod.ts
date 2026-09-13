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
