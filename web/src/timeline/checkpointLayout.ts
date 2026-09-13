/**
 * Pure pixel layout for the scrub track's checkpoint pips (W13). Kept separate from
 * `ScrubTrack` so the "never hide a checkpoint, even when several sit within a few pixels of
 * each other at full zoom-out" guarantee is directly unit-testable without mounting React.
 */

import type { GeoTime, TimeScale } from '@/types/layer'

import { visibleCheckpoints, type TimelineCheckpoint } from './checkpoints'
import type { TimeWindow } from './scale'
import { clampUnit } from './util'

/** Below this pixel gap, two pips in the same row would visually merge or fight for the same
 *  hit target, so the second one staggers to a different row instead of being hidden. */
export const MIN_PIP_SEPARATION_PX = 8

/** How many vertical rows `layoutCheckpointPips` will stagger into — bounded because
 *  `ScrubTrack` climbs each row above the baseline inside a fixed-height hit area. Comfortably
 *  more than any realistic cluster (the tightest one in the v1 manifest is three scenes bunched
 *  at the present-day end of the axis); a larger cluster falls back to the least crowded row. */
export const MAX_PIP_ROWS = 4

export interface CheckpointPipLayout {
  id: string
  t: GeoTime
  label: string
  thumbnailUrl?: string
  /** 0..1 across the track, from `scale.toUnit(t)`. */
  u: number
  /** Which vertical row this pip staggers to, 0 = the baseline row. */
  row: number
}

/**
 * Every checkpoint inside `window`, positioned and assigned a `row` so that, for any cluster of
 * at most `MAX_PIP_ROWS` pips, no two in the same row sit closer than `MIN_PIP_SEPARATION_PX` —
 * a checkpoint is never dropped to solve a collision, only staggered (beyond `MAX_PIP_ROWS` it
 * shares the least crowded row rather than disappearing).
 *
 * Greedy left-to-right, the same shape as the classic "minimum rooms for overlapping
 * intervals" scheduling problem: pips are processed in ascending screen order and placed in
 * the first row whose most-recently-placed pip is far enough away, falling back to the row
 * with the largest gap when none qualifies. Because pips are processed in sorted order,
 * checking only the *last* pip placed in each row is sufficient — nothing placed earlier in
 * that row can be closer.
 */
export function layoutCheckpointPips(
  checkpoints: readonly TimelineCheckpoint[],
  window: TimeWindow,
  scale: TimeScale,
  trackWidthPx: number,
): CheckpointPipLayout[] {
  const positioned = visibleCheckpoints(checkpoints, window)
    .map((c) => ({ ...c, u: clampUnit(scale.toUnit(c.t)) }))
    .sort((a, b) => a.u - b.u)

  const lastPxByRow: number[] = []

  return positioned.map((c) => {
    const px = c.u * trackWidthPx
    let row = 0
    let bestGap = -Infinity
    for (let r = 0; r < MAX_PIP_ROWS; r++) {
      const lastPx = lastPxByRow[r]
      const gap = lastPx === undefined ? Infinity : px - lastPx
      if (gap >= MIN_PIP_SEPARATION_PX) {
        row = r
        bestGap = gap
        break
      }
      if (gap > bestGap) {
        bestGap = gap
        row = r
      }
    }
    lastPxByRow[row] = px
    return { id: c.id, t: c.t, label: c.label, thumbnailUrl: c.thumbnailUrl, u: c.u, row }
  })
}
