/**
 * Follow-during-playback (README §4): keeps the playhead in view while `t` advances on its
 * own, by panning — never resizing — the visible window once the playhead gets close to its
 * present-side edge. Pure: no wall-clock reads, no store access. The caller (Experience.tsx,
 * next to the playback loop) owns *whether* to apply the result — see that component for how
 * "following" disengages on a manual pan/zoom during playback and re-engages on the next play
 * press; this function only ever answers "where would the window go if we are following".
 */

import { EARTH_FORMATION, type GeoTime, type ScaleKind } from '@/types/layer'

import { warpFor, type TimeWindow } from './scale'
import { clampUnit, clampWindowToDomain } from './util'

/** Once the playhead crosses this far across the visible window — toward the present, i.e.
 *  toward `u = 1` per the package orientation — `followWindow` pans it back. */
export const FOLLOW_TRIGGER_U = 0.85

/** Where the pan puts the playhead back to. */
export const FOLLOW_TARGET_U = 0.35

const BISECTION_ITERATIONS = 50

function assertFollowableScaleKind(kind: ScaleKind): asserts kind is 'symlog' | 'linear' {
  if (kind !== 'symlog' && kind !== 'linear') {
    throw new Error(`followWindow: scaleKind "${kind}" is not implemented (density is out of scope for this package)`)
  }
}

function warpedU(newest: GeoTime, oldest: GeoTime, t: GeoTime, scaleKind: 'symlog' | 'linear'): number {
  const wNewest = warpFor(scaleKind, newest)
  const wOldest = warpFor(scaleKind, oldest)
  const width = wOldest - wNewest
  if (width <= 0) return 1
  return clampUnit((wOldest - warpFor(scaleKind, t)) / width)
}

/**
 * Returns `window` unchanged unless the playhead `t` has crossed `FOLLOW_TRIGGER_U` of the
 * way across it. Once it has, pans the window (keeping its years-span exactly constant, i.e.
 * the zoom level never changes) so `t` sits back at `FOLLOW_TARGET_U`, clamped to
 * `[0, EARTH_FORMATION]` by sliding rather than shrinking the span.
 *
 * The target shift is found by bisection rather than a closed form, because `scaleKind`'s
 * warp is nonlinear (symlog) — solved directly against the *clamped* candidate window at each
 * step, so the search naturally converges on the closest achievable pan when the unclamped
 * target would overshoot the domain (e.g. the window is already pinned against the present):
 * there is nowhere further to pan, and `uAt` simply stops changing past that point.
 */
export function followWindow(window: TimeWindow, t: GeoTime, scaleKind: ScaleKind): TimeWindow {
  assertFollowableScaleKind(scaleKind)
  const [newest, oldest] = window
  const span = oldest - newest
  if (span <= 0) return window

  if (warpedU(newest, oldest, t, scaleKind) <= FOLLOW_TRIGGER_U) return window

  const uAt = (shift: GeoTime): number => {
    const [n, o] = clampWindowToDomain(newest - shift, oldest - shift, EARTH_FORMATION)
    return warpedU(n, o, t, scaleKind)
  }

  // uAt is monotonically non-increasing in `shift` (shifting the window toward the present
  // moves t toward the window's oldest/left edge), so standard bisection finds the shift
  // where it crosses FOLLOW_TARGET_U.
  let lo = 0
  let hi = EARTH_FORMATION
  for (let i = 0; i < BISECTION_ITERATIONS; i++) {
    const mid = (lo + hi) / 2
    if (uAt(mid) > FOLLOW_TARGET_U) {
      lo = mid
    } else {
      hi = mid
    }
  }

  const [n, o] = clampWindowToDomain(newest - (lo + hi) / 2, oldest - (lo + hi) / 2, EARTH_FORMATION)
  return [n, o]
}
