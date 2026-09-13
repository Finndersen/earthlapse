/**
 * Pure geometry and snapping logic for the hover loupe (brief §3): a "focus + context"
 * magnifier that floats above the cursor while it sits over the scrub track, showing ~12x the
 * local time resolution around the cursor's time — WITHOUT distorting the main track itself
 * (the main track's own cursor->time mapping stays exactly as-is; the loupe is a separate,
 * independently-scaled overlay reading the same `t`). Kept free of React so the window
 * computation and snapping are directly unit-testable.
 */

import { EARTH_FORMATION, type GeoTime, type TimelineEvent } from '@/types/layer'

import type { TimelineCheckpoint } from './checkpoints'
import { createLinearScale, type TimeWindow } from './scale'
import { clamp } from './util'
import { MIN_SPAN_YEARS } from './zoom'

/** How much more local time resolution the loupe shows than the main track it floats over —
 *  its window is `1 / LOUPE_MAGNIFICATION` of the main track's own visible span. */
export const LOUPE_MAGNIFICATION = 12

/** Rendered width of the loupe, in px (brief: "~240px wide"). */
export const LOUPE_WIDTH_PX = 240

/** Rendered height of the loupe, in px — its own mini axis plus a little breathing room. */
export const LOUPE_HEIGHT_PX = 96

/** A checkpoint/event candidate within this many *loupe pixels* of the cursor snaps (brief:
 *  "within ~10 loupe-pixels of the cursor"). */
export const LOUPE_SNAP_PX = 10

/** Gap between the cursor and the loupe's bottom edge, and the minimum margin kept from every
 *  viewport edge when clamping the loupe's position on screen. */
export const LOUPE_VERTICAL_GAP_PX = 16
export const LOUPE_VIEWPORT_MARGIN_PX = 8

/**
 * The narrow window the loupe renders: `mainWindow`'s span divided by `LOUPE_MAGNIFICATION`,
 * centred on `cursorT`, clamped to `[0, EARTH_FORMATION]` by sliding (never shrinking below
 * `MIN_SPAN_YEARS`) — the same "slide, don't shrink" rule used everywhere else in this package.
 * Pure; independent of the main track's own `scaleKind` (the loupe always reads its own window
 * with a plain linear scale — see `Loupe.tsx` — since at 1/12th of even a fully-zoomed-out span
 * the symlog warp is locally indistinguishable from linear, and a fixed local scale keeps the
 * loupe's own ticks legible without needing to know the main track's toggle state).
 */
export function loupeWindow(mainWindow: TimeWindow, cursorT: GeoTime): TimeWindow {
  const mainSpan = mainWindow[1] - mainWindow[0]
  const span = Math.max(mainSpan / LOUPE_MAGNIFICATION, MIN_SPAN_YEARS)
  let newest = cursorT - span / 2
  let oldest = cursorT + span / 2
  if (newest < 0) {
    oldest -= newest
    newest = 0
  }
  if (oldest > EARTH_FORMATION) {
    newest -= oldest - EARTH_FORMATION
    oldest = EARTH_FORMATION
  }
  return [clamp(newest, 0, EARTH_FORMATION), clamp(oldest, 0, EARTH_FORMATION)]
}

export type LoupeCandidateKind = 'event' | 'checkpoint'

export interface LoupeCandidate {
  id: string
  t: GeoTime
  label: string
  kind: LoupeCandidateKind
}

/**
 * Every event (by uncertainty-band midpoint) and checkpoint overlapping/inside `window` — no
 * importance/LOD floor, unlike the main track's `visibleEvents`: revealing detail the main
 * track's LOD suppresses is the entire point of the magnifier. Sorted by time for a stable,
 * readable render order.
 */
export function loupeCandidates(
  events: readonly TimelineEvent[],
  checkpoints: readonly TimelineCheckpoint[],
  window: TimeWindow,
): LoupeCandidate[] {
  const [newest, oldest] = window
  const eventCandidates: LoupeCandidate[] = events
    .filter((e) => e.tMax >= newest && e.tMin <= oldest)
    .map((e) => ({ id: e.id, t: (e.tMin + e.tMax) / 2, label: e.label, kind: 'event' as const }))
  const checkpointCandidates: LoupeCandidate[] = checkpoints
    .filter((c) => c.t >= newest && c.t <= oldest)
    .map((c) => ({ id: c.id, t: c.t, label: c.label, kind: 'checkpoint' as const }))
  return [...eventCandidates, ...checkpointCandidates].sort((a, b) => a.t - b.t)
}

/**
 * The candidate (if any) within `LOUPE_SNAP_PX` of `cursorT`, in the loupe's own pixel space
 * (`widthPx` wide, mapped via `scale`) — the nearest one when several qualify. `undefined` when
 * nothing is close enough, in which case the caller should scrub to the raw cursor time as
 * usual.
 */
export function findLoupeSnapTarget(
  candidates: readonly LoupeCandidate[],
  scale: { toUnit(t: GeoTime): number },
  cursorT: GeoTime,
  widthPx: number,
  snapPx: number = LOUPE_SNAP_PX,
): LoupeCandidate | undefined {
  const cursorU = scale.toUnit(cursorT)
  let best: LoupeCandidate | undefined
  let bestDistPx = Infinity
  for (const candidate of candidates) {
    const distPx = Math.abs(scale.toUnit(candidate.t) - cursorU) * widthPx
    if (distPx <= snapPx && distPx < bestDistPx) {
      best = candidate
      bestDistPx = distPx
    }
  }
  return best
}

export interface LoupePosition {
  left: number
  top: number
}

/**
 * Where the loupe renders on screen (`position: fixed` coordinates) for a cursor at
 * (`cursorClientX`, `cursorClientY`): horizontally centred over the cursor and floating
 * `LOUPE_VERTICAL_GAP_PX` above it, clamped to stay `LOUPE_VIEWPORT_MARGIN_PX` inside
 * `viewportWidthPx` x `viewportHeightPx` on every side (brief: "clamp the loupe inside the
 * viewport").
 */
export function loupePosition(
  cursorClientX: number,
  cursorClientY: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
  widthPx: number = LOUPE_WIDTH_PX,
  heightPx: number = LOUPE_HEIGHT_PX,
): LoupePosition {
  const maxLeft = Math.max(LOUPE_VIEWPORT_MARGIN_PX, viewportWidthPx - widthPx - LOUPE_VIEWPORT_MARGIN_PX)
  const maxTop = Math.max(LOUPE_VIEWPORT_MARGIN_PX, viewportHeightPx - heightPx - LOUPE_VIEWPORT_MARGIN_PX)
  const left = clamp(cursorClientX - widthPx / 2, LOUPE_VIEWPORT_MARGIN_PX, maxLeft)
  const top = clamp(cursorClientY - heightPx - LOUPE_VERTICAL_GAP_PX, LOUPE_VIEWPORT_MARGIN_PX, maxTop)
  return { left, top }
}

/** Convenience: a plain linear `TimeScale`-shaped object over `window` for the loupe's own
 *  rendering and snap-distance math — a thin re-export point so `Loupe.tsx` and ScrubTrack's
 *  snap computation build it identically. */
export function loupeScale(window: TimeWindow) {
  return createLinearScale(window)
}
