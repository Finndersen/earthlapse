/**
 * Snapping a raw pointer time to the nearest nearby event/checkpoint (brief §3: "make a click
 * scrub exactly to it, instead of the raw pointer time"). Split out of the old hover loupe
 * (ADR-017): the loupe itself is gone, but a hover/scrub still snaps against whatever the
 * track is actually drawing at the time, so this stays independent of any particular overlay.
 */

import type { GeoTime, TimelineEvent } from '@/types/layer'

import type { TimelineCheckpoint } from './checkpoints'
import type { TimeWindow } from './scale'

/** A candidate within this many *displayed* px of the cursor snaps (brief: "within ~10
 *  pixels of the cursor"). */
export const SNAP_PX = 10

export type SnapCandidateKind = 'event' | 'checkpoint'

export interface SnapCandidate {
  id: string
  t: GeoTime
  label: string
  kind: SnapCandidateKind
}

/**
 * Every event (by uncertainty-band midpoint) and checkpoint overlapping/inside `window` —
 * `events` is whatever the caller is actually drawing (its own LOD-filtered list), not the
 * full data set, so a snap never targets something invisible. Sorted by time for a stable
 * iteration order.
 */
export function snapCandidates(
  events: readonly TimelineEvent[],
  checkpoints: readonly TimelineCheckpoint[],
  window: TimeWindow,
): SnapCandidate[] {
  const [newest, oldest] = window
  const eventCandidates: SnapCandidate[] = events
    .filter((e) => e.tMax >= newest && e.tMin <= oldest)
    .map((e) => ({ id: e.id, t: (e.tMin + e.tMax) / 2, label: e.label, kind: 'event' as const }))
  const checkpointCandidates: SnapCandidate[] = checkpoints
    .filter((c) => c.t >= newest && c.t <= oldest)
    .map((c) => ({ id: c.id, t: c.t, label: c.label, kind: 'checkpoint' as const }))
  return [...eventCandidates, ...checkpointCandidates].sort((a, b) => a.t - b.t)
}

/**
 * The candidate (if any) within `snapPx` of `cursorT`, in `scale`'s own pixel space
 * (`trackWidthPx` wide) — the nearest one when several qualify. `undefined` when nothing is
 * close enough, in which case the caller should scrub to the raw cursor time as usual.
 */
export function findSnapTarget(
  candidates: readonly SnapCandidate[],
  scale: { toUnit(t: GeoTime): number },
  cursorT: GeoTime,
  trackWidthPx: number,
  snapPx: number = SNAP_PX,
): SnapCandidate | undefined {
  const cursorU = scale.toUnit(cursorT)
  let best: SnapCandidate | undefined
  let bestDistPx = Infinity
  for (const candidate of candidates) {
    const distPx = Math.abs(scale.toUnit(candidate.t) - cursorU) * trackWidthPx
    if (distPx <= snapPx && distPx < bestDistPx) {
      best = candidate
      bestDistPx = distPx
    }
  }
  return best
}
