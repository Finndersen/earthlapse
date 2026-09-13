/**
 * Playback pacing (ADR-012 update): the wall-clock durations `advancePlayhead` (timeline
 * package) must spend crossing each scene and each dissolve, so the picture stays a pure
 * function of `t` during playback while still reading as settled scenes joined by deliberate
 * dissolves rather than a blur.
 *
 * The earlier approach (a `PLAYBACK_HOLD_SECONDS` hold on the *presented* mix, downstream of
 * `t`) desynchronised the picture from every other `t`-driven readout — the display could sit
 * on a held scene for seconds while the time/era/ancestor/CO2 HUD kept advancing. Pacing the
 * *playhead* instead means `sceneAt(scenes, t)` and everything else that reads `t` stay in
 * lockstep: nothing here touches presentation, only how fast `t` itself is allowed to move.
 *
 * `scenePlaybackSegments` computes, once per manifest, the ranges of `t` that must take at
 * least a minimum number of wall-clock seconds to cross at 1x: the held part of each scene
 * (`SCENE_DWELL_SECONDS`, split across its two neighbouring gaps) and the dissolve band
 * between two scenes (`MIN_TRANSITION_SECONDS` — the same constant `presentation.ts` uses as
 * its rate-limit floor, so a paced playhead and the rate limiter agree on how long a dissolve
 * takes). `advancePlayhead` is the only consumer; it treats these as a structural
 * `{ tNewer, tOlder, minSeconds }[]` so the `timeline` package need not import `scene`.
 */

import type { GeoTime } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { MIN_TRANSITION_SECONDS } from './presentation'
import { DISSOLVE_WIDTH } from './scene'

/**
 * Total seconds a single scene dwells on screen, held clear of any dissolve, at 1x — split
 * evenly across its two neighbouring gaps (1.5 s of the hold before it, 1.5 s after). The
 * newest and oldest scene each have only one neighbouring gap, so only get the one half: "the
 * oldest/newest scene's outer half simply doesn't exist" is not a special case in the code,
 * it falls out of there being no gap to emit it into.
 */
export const SCENE_DWELL_SECONDS = 3.0

/**
 * A stretch of `t` that must take at least `minSeconds` of wall-clock time to cross at 1x
 * (`playback.speed === 1`); faster speeds divide `minSeconds` down proportionally. Always
 * `tNewer <= tOlder` (smaller `GeoTime` is nearer the present, per the package convention).
 */
export interface PlaybackSegment {
  tNewer: GeoTime
  tOlder: GeoTime
  minSeconds: number
}

/** `t` at position `p` (0..1) along the log1p-`t` interpolation between `a` and `b`, the
 *  inverse of the `p` computation inside `sceneAt` — used here to convert the dissolve band's
 *  edges (known in `p`) back into `GeoTime` boundaries. */
function tAtLogP(a: GeoTime, b: GeoTime, p: number): GeoTime {
  const logA = Math.log1p(a)
  const logB = Math.log1p(b)
  return Math.expm1(logA + p * (logB - logA))
}

/**
 * The paced segments spanning `[scenes[0].t, scenes[last].t]` exactly, contiguous and
 * ordered from newest to oldest. Each consecutive pair of scenes `a` (newer), `b` (older)
 * contributes three: `a`'s held half nearest this gap, the `DISSOLVE_WIDTH` dissolve band
 * centred on the gap's log1p midpoint (matching `sceneAt` exactly — the band's edges are the
 * same `t` values at which `sceneAt`'s mix reaches exactly 0 and exactly 1), and `b`'s held
 * half nearest this gap. Returns `[]` for zero or one scenes — there is no gap to pace.
 */
export function scenePlaybackSegments(scenes: readonly Scene[]): PlaybackSegment[] {
  const segments: PlaybackSegment[] = []
  const halfWidth = DISSOLVE_WIDTH / 2
  const halfDwell = SCENE_DWELL_SECONDS / 2

  for (let i = 0; i < scenes.length - 1; i++) {
    const a = scenes[i]!
    const b = scenes[i + 1]!
    const bandNewerEdge = tAtLogP(a.t, b.t, 0.5 - halfWidth)
    const bandOlderEdge = tAtLogP(a.t, b.t, 0.5 + halfWidth)

    segments.push({ tNewer: a.t, tOlder: bandNewerEdge, minSeconds: halfDwell })
    segments.push({ tNewer: bandNewerEdge, tOlder: bandOlderEdge, minSeconds: MIN_TRANSITION_SECONDS })
    segments.push({ tNewer: bandOlderEdge, tOlder: b.t, minSeconds: halfDwell })
  }

  return segments
}
