/**
 * Room-based decluttering for event markers (ADR-019, superseding the span-based importance
 * floor `lod.ts` used to apply to rendering). Rather than hiding every event below a global
 * importance threshold — which left most of the axis empty at full zoom-out whenever few events
 * cleared it — every event overlapping the window is a candidate; importance only decides which
 * one wins when two would collide on screen. Because this runs on whatever `scale` the caller
 * passes, feeding it the fisheye scale means hovering the track reveals events that lacked room
 * at the resting (undistorted) magnification, exactly as the checkpoint clustering in
 * `checkpointLayout.ts` does for scene pips.
 */

import type { GeoTime, TimeScale, TimelineEvent } from '@/types/layer'

import type { TimeWindow } from './scale'
import { clampUnit } from './util'

/** The minimum displayed width, in px, a single event marker claims when checking for
 *  collisions — a point event (`tMin === tMax`) would otherwise have a zero-width band and
 *  could never collide with anything, no matter how tightly packed. */
export const MIN_EVENT_MARKER_PX = 6

/** Minimum displayed gap, in px, required between two accepted markers' bands. */
export const MIN_EVENT_GAP_PX = 4

function overlapsWindow(e: TimelineEvent, newest: GeoTime, oldest: GeoTime): boolean {
  return e.tMax >= newest && e.tMin <= oldest
}

/** `[startPx, endPx]` of `event`'s displayed band, widened to at least `MIN_EVENT_MARKER_PX`
 *  and kept centred on the band's own midpoint. */
function markerBandPx(event: TimelineEvent, scale: TimeScale, trackWidthPx: number): [number, number] {
  const startU = clampUnit(scale.toUnit(event.tMax))
  const endU = clampUnit(scale.toUnit(event.tMin))
  const startPx = startU * trackWidthPx
  const endPx = endU * trackWidthPx
  const width = Math.max(endPx - startPx, MIN_EVENT_MARKER_PX)
  const centrePx = (startPx + endPx) / 2
  return [centrePx - width / 2, centrePx + width / 2]
}

function bandsCollide(a: [number, number], b: [number, number], gapPx: number): boolean {
  return a[0] < b[1] + gapPx && b[0] < a[1] + gapPx
}

/**
 * The events to actually draw on `scale` over a `trackWidthPx`-wide track: every event
 * overlapping `window`, processed importance-descending (ties broken by the narrower
 * uncertainty band first, then `id`, for a deterministic result independent of input order) and
 * accepted unless its displayed band — widened to `MIN_EVENT_MARKER_PX` — comes within
 * `MIN_EVENT_GAP_PX` of an already-accepted band. Returned in time order (oldest first), which
 * is unrelated to the acceptance order above.
 *
 * `trackWidthPx <= 0` (not yet measured) has no pixel space to declutter against, so nothing is
 * hidden — every overlapping event is returned rather than every candidate colliding at 0px.
 */
export function declutterEvents(
  events: readonly TimelineEvent[],
  window: TimeWindow,
  scale: TimeScale,
  trackWidthPx: number,
): TimelineEvent[] {
  const [newest, oldest] = window
  const overlapping = events.filter((e) => overlapsWindow(e, newest, oldest))
  if (!(trackWidthPx > 0)) return overlapping.sort((a, b) => a.tMin - b.tMin)

  const ranked = [...overlapping].sort((a, b) => {
    if (b.importance !== a.importance) return b.importance - a.importance
    const bandA = a.tMax - a.tMin
    const bandB = b.tMax - b.tMin
    if (bandA !== bandB) return bandA - bandB
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  const accepted: { event: TimelineEvent; band: [number, number] }[] = []
  for (const event of ranked) {
    const band = markerBandPx(event, scale, trackWidthPx)
    const collides = accepted.some((a) => bandsCollide(a.band, band, MIN_EVENT_GAP_PX))
    if (!collides) accepted.push({ event, band })
  }

  return accepted.map((a) => a.event).sort((a, b) => a.tMin - b.tMin)
}
