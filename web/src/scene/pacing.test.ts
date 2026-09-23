import { describe, expect, it } from 'vitest'

import type { Scene } from '@/types/manifest'

import {
  MAX_GAP_BONUS_SECONDS,
  playbackSecondsBetween,
  scenePlaybackSegments,
  SCENE_DWELL_SECONDS,
  yearsForPlaybackSeconds,
} from './pacing'
import type { PlaybackSegment } from './pacing'
import { MIN_TRANSITION_SECONDS } from './presentation'
import { sceneAt } from './scene'

function scene(id: string, t: number): Scene {
  return { id, t, chapterId: 'ch', image: `${id}.png`, thumbnail: `${id}-t.png`, shot: 'WIDE_RIDGE', title: id, caption: id, width: 1920, height: 1080 }
}

const [s0, s1, s2, s3] = [0, 100, 1e6, 4.5e9].map((t, i) => scene(`s${i}`, t)) as [Scene, Scene, Scene, Scene]
const SCENES = [s0, s1, s2, s3]
const SEGMENTS = scenePlaybackSegments(SCENES)

function holds(pair: [number, number]): [PlaybackSegment, PlaybackSegment, PlaybackSegment] {
  return scenePlaybackSegments([scene('a', pair[0]), scene('b', pair[1])]) as [PlaybackSegment, PlaybackSegment, PlaybackSegment]
}

describe('scenePlaybackSegments', () => {
  it('is empty with fewer than two scenes', () => {
    expect(scenePlaybackSegments([])).toEqual([])
    expect(scenePlaybackSegments([s0])).toEqual([])
  })

  it('emits hold, dissolve, hold per gap, contiguous across the covered range', () => {
    expect(SEGMENTS).toHaveLength(9)
    expect(SEGMENTS[0]!.tNewer).toBe(s0.t)
    expect(SEGMENTS.at(-1)!.tOlder).toBe(s3.t)
    for (let i = 0; i < SEGMENTS.length; i++) {
      expect(SEGMENTS[i]!.tNewer).toBeLessThanOrEqual(SEGMENTS[i]!.tOlder)
      if (i + 1 < SEGMENTS.length) expect(SEGMENTS[i]!.tOlder).toBe(SEGMENTS[i + 1]!.tNewer)
      if (i % 3 === 1) expect(SEGMENTS[i]!.durationSeconds).toBe(MIN_TRANSITION_SECONDS)
      else expect(SEGMENTS[i]!.durationSeconds).toBeGreaterThanOrEqual(SCENE_DWELL_SECONDS / 2)
    }
  })

  it("places dissolve band edges exactly where sceneAt's mix reaches 0 and 1", () => {
    for (let gap = 0; gap < 3; gap++) {
      const [newerHold, dissolve, olderHold] = SEGMENTS.slice(gap * 3, gap * 3 + 3) as [PlaybackSegment, PlaybackSegment, PlaybackSegment]
      expect(sceneAt(SCENES, dissolve.tNewer).mix).toBeCloseTo(0, 9)
      expect(sceneAt(SCENES, dissolve.tOlder).mix).toBeCloseTo(1, 9)
      expect(sceneAt(SCENES, (newerHold.tNewer + newerHold.tOlder) / 2).mix).toBe(0)
      expect(sceneAt(SCENES, (olderHold.tNewer + olderHold.tOlder) / 2).mix).toBe(1)
    }
  })

  it('adds a gap bonus split evenly, growing with span from ~0 up to MAX_GAP_BONUS_SECONDS', () => {
    expect(holds([0, 1])[0].durationSeconds).toBeCloseTo(SCENE_DWELL_SECONDS / 2, 3)
    const [vastNewer, vastDissolve, vastOlder] = holds([1, 4.567e9])
    expect(vastNewer.durationSeconds).toBe(SCENE_DWELL_SECONDS / 2 + MAX_GAP_BONUS_SECONDS / 2)
    expect(vastOlder.durationSeconds).toBe(vastNewer.durationSeconds)
    expect(vastDissolve.durationSeconds).toBe(MIN_TRANSITION_SECONDS)
    let previous = 0
    for (const span of [1, 1e3, 1e6, 1e9]) {
      const [newer, , older] = holds([0, span])
      expect(newer.durationSeconds).toBe(older.durationSeconds)
      expect(newer.durationSeconds).toBeGreaterThanOrEqual(previous)
      previous = newer.durationSeconds
    }
  })
})

describe('playbackSecondsBetween', () => {
  const total = SEGMENTS.reduce((sum, seg) => sum + seg.durationSeconds, 0)

  it('sums additively to the segment total, exactly per segment', () => {
    expect(playbackSecondsBetween(SEGMENTS, s0.t, s3.t)).toBeCloseTo(total, 9)
    expect(playbackSecondsBetween(SEGMENTS, SEGMENTS[0]!.tNewer, SEGMENTS[0]!.tOlder)).toBeCloseTo(SEGMENTS[0]!.durationSeconds, 9)
    const mid = SEGMENTS[1]!.tOlder
    expect(playbackSecondsBetween(SEGMENTS, s0.t, mid) + playbackSecondsBetween(SEGMENTS, mid, s3.t)).toBeCloseTo(total, 9)
  })

  it('counts only covered time, zero outside or for an empty range', () => {
    expect(playbackSecondsBetween(SEGMENTS, s1.t, s1.t)).toBe(0)
    expect(playbackSecondsBetween(SEGMENTS, -100, -1)).toBe(0)
    expect(playbackSecondsBetween([], 0, 1000)).toBe(0)
    expect(playbackSecondsBetween(SEGMENTS, -50, 10)).toBeCloseTo(playbackSecondsBetween(SEGMENTS, 0, 10), 9)
    expect(playbackSecondsBetween(SEGMENTS, s3.t - 10, s3.t + 50)).toBeCloseTo(playbackSecondsBetween(SEGMENTS, s3.t - 10, s3.t), 9)
    expect(() => playbackSecondsBetween(SEGMENTS, s3.t, s0.t)).toThrow()
  })

  it('prorates within a segment by symlog u, not linear t', () => {
    const wide = scenePlaybackSegments([scene('a', 1e6), scene('b', 1e9)])
    const first = wide[0]!
    expect(playbackSecondsBetween(wide, first.tNewer, (first.tNewer + first.tOlder) / 2)).toBeGreaterThan(first.durationSeconds / 2)
  })
})

describe('yearsForPlaybackSeconds', () => {
  it.each([
    [s2.t, 4],
    [s3.t, 15],
  ])('round-trips with playbackSecondsBetween from t=%s for %ss', (t, budget) => {
    const years = yearsForPlaybackSeconds(SEGMENTS, t, budget)
    expect(playbackSecondsBetween(SEGMENTS, t - years, t)).toBeCloseTo(budget, 6)
  })

  it('grows with the budget and clamps at the present', () => {
    expect(yearsForPlaybackSeconds(SEGMENTS, s2.t, 0)).toBeCloseTo(0, 6)
    expect(yearsForPlaybackSeconds(SEGMENTS, s3.t, 5)).toBeGreaterThan(yearsForPlaybackSeconds(SEGMENTS, s3.t, 1))
    expect(yearsForPlaybackSeconds(SEGMENTS, s1.t, 1e9)).toBe(s1.t)
    expect(yearsForPlaybackSeconds([], 500, 1)).toBe(500)
    expect(() => yearsForPlaybackSeconds(SEGMENTS, s2.t, -1)).toThrow()
  })
})
