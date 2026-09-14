/**
 * Scene checkpoints (W13): the curated stills the viewer actually sees, plotted on the
 * timeline distinct from data-driven `TimelineEvent`s. Unlike events, a checkpoint carries no
 * `importance`/LOD — every one inside the visible window is always drawn (they are the images
 * the viewer sees, not annotations on the axis) — so `visibleCheckpoints` below is a plain
 * window-overlap test, not `lod.ts`'s span-driven importance threshold.
 */

import type { GeoTime, TimelineEvent } from '@/types/layer'

import { nearestNeighbourEvent, type EventStepDirection } from './lod'
import type { TimeWindow } from './scale'

export interface TimelineCheckpoint {
  id: string
  t: GeoTime
  label: string
  thumbnailUrl?: string
}

/** Checkpoints whose `t` falls inside `window` — the full set the scrub track's pips and the
 *  stepping helpers below work from (no importance floor, unlike `visibleEvents`). */
export function visibleCheckpoints(checkpoints: readonly TimelineCheckpoint[], window: TimeWindow): TimelineCheckpoint[] {
  const [newest, oldest] = window
  return checkpoints.filter((c) => c.t >= newest && c.t <= oldest)
}

/**
 * The nearest visible checkpoint in `direction` from `t`. Mirrors `nearestNeighbourEvent`'s
 * contract exactly (same "`'back'` = further into the past, `'forward'` = toward the present"
 * orientation, same reduce-to-closest shape) so the two are directly comparable in
 * `nearestStepTarget` below.
 */
export function nearestNeighbourCheckpoint(
  checkpoints: readonly TimelineCheckpoint[],
  window: TimeWindow,
  t: GeoTime,
  direction: EventStepDirection,
): TimelineCheckpoint | undefined {
  const shown = visibleCheckpoints(checkpoints, window)
  const candidates = direction === 'back' ? shown.filter((c) => c.t > t) : shown.filter((c) => c.t < t)
  if (candidates.length === 0) return undefined
  return direction === 'back'
    ? candidates.reduce((a, b) => (a.t < b.t ? a : b))
    : candidates.reduce((a, b) => (a.t > b.t ? a : b))
}

/**
 * The time to scrub to when stepping `direction` from `t` — shared by the transport's
 * back/forward buttons and the ←/→ keyboard shortcut, so every scene is reachable by stepping
 * even when it sits strictly between two `TimelineEvent`s (or has none nearby at all). Steps
 * through every event overlapping `window`, not just the ones `declutter.ts` currently draws
 * (ADR-019) — a keyboard/transport user must never be blocked by a marker that lost a room
 * collision.
 *
 * Both `nearestNeighbourEvent` and `nearestNeighbourCheckpoint` already return *the* nearest
 * candidate from their own set, so the nearer of the two is simply the smaller time for
 * `'back'` (both candidates lie in the future relative to `t`, i.e. further into the past —
 * smaller `t` is closer) and the larger for `'forward'` (both lie nearer the present — larger
 * `t` is closer). `undefined` only when neither set has a candidate in that direction.
 */
export function nearestStepTarget(
  events: readonly TimelineEvent[],
  checkpoints: readonly TimelineCheckpoint[],
  window: TimeWindow,
  t: GeoTime,
  direction: EventStepDirection,
): GeoTime | undefined {
  const nearestEvent = nearestNeighbourEvent(events, window, t, direction)
  const nearestCheckpoint = nearestNeighbourCheckpoint(checkpoints, window, t, direction)
  const eventT = nearestEvent ? (nearestEvent.tMin + nearestEvent.tMax) / 2 : undefined
  const checkpointT = nearestCheckpoint?.t

  if (eventT === undefined) return checkpointT
  if (checkpointT === undefined) return eventT
  return direction === 'back' ? Math.min(eventT, checkpointT) : Math.max(eventT, checkpointT)
}
