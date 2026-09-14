import { describe, expect, it } from 'vitest'

import type { Scene } from '@/types/manifest'

import { MAX_GAP_BONUS_SECONDS, scenePlaybackSegments, SCENE_DWELL_SECONDS } from './pacing'
import type { PlaybackSegment } from './pacing'
import { MIN_TRANSITION_SECONDS } from './presentation'
import { sceneAt } from './scene'

function scene(id: string, t: number): Scene {
  return {
    id,
    t,
    chapterId: 'ch',
    image: `${id}.png`,
    shot: 'WIDE_RIDGE',
    caption: `caption ${id}`,
    width: 1920,
    height: 1080,
  }
}

const s0 = scene('s0', 0)
const s1 = scene('s1', 100)
const s2 = scene('s2', 1e6)
const s3 = scene('s3', 4.5e9)

describe('scenePlaybackSegments: empty/single input', () => {
  it('returns [] for no scenes', () => {
    expect(scenePlaybackSegments([])).toEqual([])
  })

  it('returns [] for a single scene — no gap to pace', () => {
    expect(scenePlaybackSegments([s0])).toEqual([])
  })
})

describe('scenePlaybackSegments: shape and coverage', () => {
  const scenes = [s0, s1, s2, s3]
  const segments = scenePlaybackSegments(scenes)

  it('emits exactly 3 segments per gap', () => {
    expect(segments).toHaveLength(3 * (scenes.length - 1))
  })

  it('every segment has tNewer <= tOlder', () => {
    for (const seg of segments) {
      expect(seg.tNewer).toBeLessThanOrEqual(seg.tOlder)
    }
  })

  it('is contiguous: each segment ends exactly where the next begins', () => {
    for (let i = 0; i + 1 < segments.length; i++) {
      expect(segments[i]!.tOlder).toBe(segments[i + 1]!.tNewer)
    }
  })

  it('covers [scenes[0].t, scenes[last].t] exactly, with no gap or overlap', () => {
    expect(segments[0]!.tNewer).toBe(s0.t)
    expect(segments[segments.length - 1]!.tOlder).toBe(s3.t)
  })

  it('gives the dissolve band exactly MIN_TRANSITION_SECONDS regardless of the gap — the bonus never touches it', () => {
    for (let gap = 0; gap < scenes.length - 1; gap++) {
      const dissolve = segments[gap * 3 + 1]!
      expect(dissolve.durationSeconds).toBe(MIN_TRANSITION_SECONDS)
    }
  })

  it('gives every hold segment at least SCENE_DWELL_SECONDS / 2 (the base dwell, before any bonus)', () => {
    for (const seg of [...segments.filter((_, i) => i % 3 !== 1)]) {
      expect(seg.durationSeconds).toBeGreaterThanOrEqual(SCENE_DWELL_SECONDS / 2)
    }
  })
})

describe('scenePlaybackSegments: band edges agree with sceneAt', () => {
  const scenes = [s0, s1, s2, s3]
  const segments = scenePlaybackSegments(scenes)

  it('the dissolve band edges are where sceneAt reaches mix 0 and mix 1 (to float precision — the edges are computed by inverting sceneAt\'s own log1p interpolation, so the round trip can leave sceneAt a sub-double-precision hair inside the band rather than landing on an exact 0/1)', () => {
    for (let gap = 0; gap < scenes.length - 1; gap++) {
      const dissolve = segments[gap * 3 + 1]!
      expect(sceneAt(scenes, dissolve.tNewer).mix).toBeCloseTo(0, 9)
      expect(sceneAt(scenes, dissolve.tOlder).mix).toBeCloseTo(1, 9)
    }
  })

  it('a t inside either held segment (outside the band) is still fully settled at mix 0/1', () => {
    for (let gap = 0; gap < scenes.length - 1; gap++) {
      const [newerHold, , olderHold] = segments.slice(gap * 3, gap * 3 + 3) as [
        PlaybackSegment,
        PlaybackSegment,
        PlaybackSegment,
      ]
      const midOfNewerHold = (newerHold.tNewer + newerHold.tOlder) / 2
      const midOfOlderHold = (olderHold.tNewer + olderHold.tOlder) / 2
      expect(sceneAt(scenes, midOfNewerHold).mix).toBe(0)
      expect(sceneAt(scenes, midOfOlderHold).mix).toBe(1)
    }
  })
})

describe('scenePlaybackSegments: per-scene dwell split across neighbouring gaps', () => {
  it('an interior scene\'s two neighbouring holds sum to SCENE_DWELL_SECONDS plus half of each gap\'s own bonus', () => {
    const scenes = [s0, s1, s2, s3]
    const segments = scenePlaybackSegments(scenes)
    // s1 is scenes[1]: the "newer hold" of gap(0,1) plus the "older hold" of gap(1,2).
    const newerHoldForS1 = segments[2]! // third segment of gap(0,1): [bandOlderEdge, s1.t]
    const olderHoldForS1 = segments[3]! // first segment of gap(1,2): [s1.t, bandNewerEdge]
    expect(newerHoldForS1.tOlder).toBe(s1.t)
    expect(olderHoldForS1.tNewer).toBe(s1.t)
    // Each hold is at least the base half-dwell; the total is exactly SCENE_DWELL_SECONDS
    // only when both neighbouring gaps happen to have zero bonus, so assert the floor rather
    // than an exact figure here — the dedicated bonus tests below pin the bonus itself down.
    expect(newerHoldForS1.durationSeconds + olderHoldForS1.durationSeconds).toBeGreaterThanOrEqual(SCENE_DWELL_SECONDS)
  })

  it('the newest scene has no outer half (no segment before scenes[0].t)', () => {
    const scenes = [s0, s1, s2, s3]
    const segments = scenePlaybackSegments(scenes)
    expect(segments[0]!.tNewer).toBe(s0.t)
  })

  it('the oldest scene has no outer half (no segment after scenes[last].t)', () => {
    const scenes = [s0, s1, s2, s3]
    const segments = scenePlaybackSegments(scenes)
    expect(segments[segments.length - 1]!.tOlder).toBe(s3.t)
  })
})

// --------------------------------------------------------------------------- gap bonus (ADR-016)

describe('scenePlaybackSegments: gap bonus (ADR-016)', () => {
  it('a dense gap (tiny full-domain symlog u-span) gets a bonus indistinguishable from zero', () => {
    // t=0 to t=1: the smallest possible non-zero gap, deep inside the near-linear region —
    // its share of the full domain's symlog span is on the order of 1e-5.
    const dense = [scene('a', 0), scene('b', 1)]
    const [held] = scenePlaybackSegments(dense)
    expect(held!.durationSeconds).toBeCloseTo(SCENE_DWELL_SECONDS / 2, 3)
  })

  it('a gap spanning nearly the whole domain saturates at MAX_GAP_BONUS_SECONDS exactly', () => {
    // t=1 to EARTH_FORMATION: covers essentially the entire domain, far past the ramp's
    // saturation point (GAP_BONUS_SATURATION_U = 0.15 of the full domain) — Math.min(1, x)
    // for x > 1 always returns exactly 1, so this is an exact figure, not an approximation.
    const vast = [scene('a', 1), scene('b', 4.567e9)]
    const segments = scenePlaybackSegments(vast)
    const [newerHold, dissolve, olderHold] = segments as [PlaybackSegment, PlaybackSegment, PlaybackSegment]
    expect(newerHold.durationSeconds).toBe(SCENE_DWELL_SECONDS / 2 + MAX_GAP_BONUS_SECONDS / 2)
    expect(olderHold.durationSeconds).toBe(SCENE_DWELL_SECONDS / 2 + MAX_GAP_BONUS_SECONDS / 2)
    // The bonus never reaches the dissolve band, however vast the gap.
    expect(dissolve.durationSeconds).toBe(MIN_TRANSITION_SECONDS)
  })

  it('the bonus never exceeds MAX_GAP_BONUS_SECONDS combined across a gap\'s two holds, for any span', () => {
    const spans = [1, 10, 1e3, 1e6, 1e9, 4.567e9]
    for (const t of spans) {
      const pair = [scene('a', 0), scene('b', t)]
      const segments = scenePlaybackSegments(pair)
      const [newerHold, , olderHold] = segments as [PlaybackSegment, PlaybackSegment, PlaybackSegment]
      const combinedBonus = newerHold.durationSeconds + olderHold.durationSeconds - SCENE_DWELL_SECONDS
      expect(combinedBonus).toBeGreaterThanOrEqual(-1e-9)
      expect(combinedBonus).toBeLessThanOrEqual(MAX_GAP_BONUS_SECONDS + 1e-9)
    }
  })

  it('the bonus grows monotonically with a gap\'s full-domain symlog u-span', () => {
    const spans = [1, 1e3, 1e6, 1e9]
    let previousHold = 0
    for (const t of spans) {
      const pair = [scene('a', 0), scene('b', t)]
      const [held] = scenePlaybackSegments(pair)
      expect(held!.durationSeconds).toBeGreaterThanOrEqual(previousHold)
      previousHold = held!.durationSeconds
    }
  })

  it('splits a gap\'s bonus evenly across its two neighbouring holds', () => {
    const pair = [scene('a', 0), scene('b', 1e8)]
    const segments = scenePlaybackSegments(pair)
    const [newerHold, , olderHold] = segments as [PlaybackSegment, PlaybackSegment, PlaybackSegment]
    expect(newerHold.durationSeconds).toBe(olderHold.durationSeconds)
  })
})
