import { describe, expect, it } from 'vitest'

import type { Scene } from '@/types/manifest'

import type { PlaybackSegment } from './pacing'
import { scenePlaybackSegments, SCENE_DWELL_SECONDS } from './pacing'
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

  it('gives the hold segments SCENE_DWELL_SECONDS / 2 and the dissolve band MIN_TRANSITION_SECONDS', () => {
    for (let gap = 0; gap < scenes.length - 1; gap++) {
      const [held, dissolve, held2] = segments.slice(gap * 3, gap * 3 + 3) as [
        PlaybackSegment,
        PlaybackSegment,
        PlaybackSegment,
      ]
      expect(held.minSeconds).toBe(SCENE_DWELL_SECONDS / 2)
      expect(dissolve.minSeconds).toBe(MIN_TRANSITION_SECONDS)
      expect(held2.minSeconds).toBe(SCENE_DWELL_SECONDS / 2)
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
  it('an interior scene gets SCENE_DWELL_SECONDS total, split 50/50 across its two gaps', () => {
    const scenes = [s0, s1, s2, s3]
    const segments = scenePlaybackSegments(scenes)
    // s1 is scenes[1]: the "newer hold" of gap(0,1) plus the "older hold" of gap(1,2).
    const newerHoldForS1 = segments[2]! // third segment of gap(0,1): [bandOlderEdge, s1.t]
    const olderHoldForS1 = segments[3]! // first segment of gap(1,2): [s1.t, bandNewerEdge]
    expect(newerHoldForS1.tOlder).toBe(s1.t)
    expect(olderHoldForS1.tNewer).toBe(s1.t)
    expect(newerHoldForS1.minSeconds + olderHoldForS1.minSeconds).toBe(SCENE_DWELL_SECONDS)
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
