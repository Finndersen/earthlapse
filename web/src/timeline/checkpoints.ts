/**
 * Scene checkpoints (W13): the curated stills the viewer actually sees, plotted on the
 * timeline distinct from data-driven `TimelineEvent`s. Unlike events, a checkpoint carries no
 * `importance`/LOD — every one inside the visible window is always drawn (they are the images
 * the viewer sees, not annotations on the axis) — so `visibleCheckpoints` below is a plain
 * window-overlap test, not `lod.ts`'s span-driven importance threshold.
 */

import type { GeoTime, Playback, TimelineEvent } from '@/types/layer'

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
 * back/forward buttons and the ←/→ keyboard shortcut.
 *
 * Steps between scenes only, never events. The transport sits beside play/pause and reads as
 * "move through the presentation", and the presentation is the curated stills: stepping to an
 * event usually leaves the same scene on screen, so the button appears to do nothing. Events
 * stay reachable by their timeline markers and surface themselves in the feed as the playhead
 * passes them.
 *
 * `undefined` when no checkpoint lies in that direction within `window`.
 */
export function nearestStepTarget(
  checkpoints: readonly TimelineCheckpoint[],
  window: TimeWindow,
  t: GeoTime,
  direction: EventStepDirection,
): GeoTime | undefined {
  return nearestNeighbourCheckpoint(checkpoints, window, t, direction)?.t
}

/**
 * The transport's step (back/forward buttons, ←/→). In `'scenes'` mode, the neighbouring scene
 * (`nearestStepTarget`). In `'steady'` mode, one second of playback at the chosen rate, so manual
 * stepping walks time at the pace playing would; clamped to `window`, and `undefined` at its edge.
 */
export function transportStepTarget(
  checkpoints: readonly TimelineCheckpoint[],
  window: TimeWindow,
  t: GeoTime,
  direction: EventStepDirection,
  playback: Pick<Playback, 'mode' | 'yearsPerSecond'>,
): GeoTime | undefined {
  if (playback.mode !== 'steady') return nearestStepTarget(checkpoints, window, t, direction)
  const [newest, oldest] = window
  const stepped = direction === 'back' ? t + playback.yearsPerSecond : t - playback.yearsPerSecond
  const target = Math.min(oldest, Math.max(newest, stepped))
  return target === t ? undefined : target
}
