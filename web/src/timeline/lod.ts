/** Stepping helpers shared by the transport's back/forward buttons and the ←/→ keyboard
 *  shortcut. Rendering-time level of detail is `declutter.ts` (ADR-019) — this module only
 *  finds "the next event in a direction", which must reach every event overlapping the window
 *  regardless of whether that event currently has room to draw. */

import type { GeoTime, TimelineEvent } from '@/types/layer'

import type { TimeWindow } from './scale'

export type EventStepDirection = 'back' | 'forward'

function overlaps(e: TimelineEvent, newest: GeoTime, oldest: GeoTime): boolean {
  return e.tMax >= newest && e.tMin <= oldest
}

/**
 * The nearest event in `direction` from `t` among every event whose uncertainty band overlaps
 * `window` — `'back'` being further into the past (screen-left), `'forward'` toward the present
 * (screen-right), matching the package's left-to-right-is-past-to-present orientation.
 * `undefined` when there is no such event.
 *
 * Deliberately reads every overlapping event, not `declutter.ts`'s drawn subset (ADR-019): a
 * keyboard or transport user must be able to reach an event that lost a collision against a
 * higher-importance neighbour and so isn't currently drawn — declutter only decides what's
 * visible, never what's reachable.
 */
export function nearestNeighbourEvent(
  events: readonly TimelineEvent[],
  window: TimeWindow,
  t: GeoTime,
  direction: EventStepDirection,
): TimelineEvent | undefined {
  const [newest, oldest] = window
  const overlapping = events.filter((e) => overlaps(e, newest, oldest))
  const candidates = direction === 'back' ? overlapping.filter((e) => e.tMin > t) : overlapping.filter((e) => e.tMax < t)
  if (candidates.length === 0) return undefined
  return direction === 'back'
    ? candidates.reduce((a, b) => (a.tMin < b.tMin ? a : b))
    : candidates.reduce((a, b) => (a.tMax > b.tMax ? a : b))
}
