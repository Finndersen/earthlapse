/**
 * `Event.placement_t` (ADR-022), computed on the frontend: a `'moment'` event's best-estimate
 * `t` when present, else the `[tMin, tMax]` interval's midpoint — the same fallback pipeline's
 * `Event.placement_t` uses for a `'period'`, and here also for any event published before
 * `kind`/`t` existed (both fields are optional on the wire type for exactly that reason, see
 * `TimelineEvent`'s own doc comments). Never presented as *the* date on its own — see
 * `formatEventDate` for what a card actually prints.
 */

import { formatGeoTime, formatTimeRange } from '@/timeline'
import type { GeoTime, TimelineEvent } from '@/types/layer'

export function placementT(event: TimelineEvent): GeoTime {
  if (event.kind === 'moment' && event.t !== undefined) return event.t
  return (event.tMin + event.tMax) / 2
}

/**
 * A feed card's date line: a `'moment'` prints its best-estimate instant (`formatGeoTime`); a
 * `'period'` prints its span (`formatTimeRange`). An event with no `kind` (predates ADR-022)
 * falls back to the same rule an exact-point interval would use — a single instant when
 * `tMin === tMax`, otherwise a range — so older manifests still read sensibly.
 */
export function formatEventDate(event: TimelineEvent): string {
  const isPeriod = event.kind === 'period' || (event.kind === undefined && event.tMin !== event.tMax)
  if (isPeriod) return formatTimeRange([event.tMin, event.tMax])
  return formatGeoTime(event.kind === 'moment' && event.t !== undefined ? event.t : placementT(event))
}
