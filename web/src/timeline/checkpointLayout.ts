/**
 * Pure pixel layout for the scrub track's checkpoint pips (W13, ADR-019). Kept separate from
 * `ScrubTrack` so the "never hide a checkpoint, even when several sit within a few pixels of
 * each other" guarantee is directly unit-testable without mounting React.
 *
 * Checkpoints that would render within `MIN_PIP_SEPARATION_PX` of a neighbour cluster into one
 * marker instead of staggering into vertical rows (ADR-019: rows read as a strange stack, not a
 * timeline). Layout runs on whatever `scale` the caller passes — when that is the fisheye scale
 * (`Timeline`'s `trackScale`), hovering near a cluster stretches its members apart until they
 * cross `MIN_PIP_SEPARATION_PX` and the layout resolves them back into individual pips on the
 * next call; moving away lets them re-cluster.
 */

import type { GeoTime, TimeScale } from '@/types/layer'

import { visibleCheckpoints, type TimelineCheckpoint } from './checkpoints'
import type { TimeWindow } from './scale'
import { clampUnit } from './util'

/** Below this pixel gap, two consecutive pips merge into one cluster marker rather than each
 *  rendering (and fighting for the same hit target) on its own. */
export const MIN_PIP_SEPARATION_PX = 8

export interface CheckpointPipLayout {
  kind: 'pip'
  id: string
  t: GeoTime
  label: string
  thumbnailUrl?: string
  /** 0..1 across the track, from `scale.toUnit(t)`. */
  u: number
}

export interface CheckpointClusterLayout {
  kind: 'cluster'
  /** The first member's id (in screen order) — stable across re-layout as long as that
   *  checkpoint stays in the cluster, so hover state does not flicker while the fisheye lens
   *  changes exactly which neighbours have merged into it. */
  id: string
  /** Mean of the members' own displayed `u` — where the cluster marker sits on the baseline. */
  u: number
  tMin: GeoTime
  tMax: GeoTime
  /** Every clustered checkpoint, in screen order (oldest to newest). */
  members: readonly TimelineCheckpoint[]
}

export type CheckpointLayoutEntry = CheckpointPipLayout | CheckpointClusterLayout

/**
 * Every checkpoint inside `window`, positioned by `scale` and grouped into `CheckpointLayoutEntry`
 * entries so that no two entries render closer than `MIN_PIP_SEPARATION_PX` — a checkpoint is
 * never dropped to solve a collision, only merged into a cluster with its neighbours.
 *
 * Single-link (chain) clustering over positions sorted left to right: two adjacent checkpoints
 * merge when they are closer than `MIN_PIP_SEPARATION_PX`, and merging is transitive along the
 * chain (a merges with b, b with c => a, b, c form one cluster) even if a and c themselves would
 * not have merged directly — the same reasoning a person visually grouping dots on a line would
 * use. A cluster of one is just a pip.
 */
export function layoutCheckpointPips(
  checkpoints: readonly TimelineCheckpoint[],
  window: TimeWindow,
  scale: TimeScale,
  trackWidthPx: number,
): CheckpointLayoutEntry[] {
  const positioned = visibleCheckpoints(checkpoints, window)
    .map((c) => ({ checkpoint: c, u: clampUnit(scale.toUnit(c.t)) }))
    .sort((a, b) => a.u - b.u)

  // `trackWidthPx <= 0` (not yet measured, e.g. the first render before `useTrackWidth`'s
  // `ResizeObserver` reports a real size) has no pixel space to judge proximity by — every gap
  // would read as 0px and everything would collapse into a single cluster. Render each
  // checkpoint as its own pip instead, matching `declutterEvents`'s identical guard.
  if (!(trackWidthPx > 0)) return positioned.map(({ checkpoint, u }) => ({ kind: 'pip', id: checkpoint.id, t: checkpoint.t, label: checkpoint.label, thumbnailUrl: checkpoint.thumbnailUrl, u }))

  const groups: (typeof positioned)[] = []
  for (const entry of positioned) {
    const currentGroup = groups.at(-1)
    const lastInGroup = currentGroup?.at(-1)
    const gapPx = lastInGroup === undefined ? Infinity : (entry.u - lastInGroup.u) * trackWidthPx
    if (currentGroup !== undefined && gapPx < MIN_PIP_SEPARATION_PX) {
      currentGroup.push(entry)
    } else {
      groups.push([entry])
    }
  }

  return groups.map((group): CheckpointLayoutEntry => {
    if (group.length === 1) {
      const { checkpoint, u } = group[0]!
      return { kind: 'pip', id: checkpoint.id, t: checkpoint.t, label: checkpoint.label, thumbnailUrl: checkpoint.thumbnailUrl, u }
    }
    const members = group.map((g) => g.checkpoint)
    const meanU = group.reduce((sum, g) => sum + g.u, 0) / group.length
    const ts = members.map((m) => m.t)
    return { kind: 'cluster', id: members[0]!.id, u: meanU, tMin: Math.min(...ts), tMax: Math.max(...ts), members }
  })
}
