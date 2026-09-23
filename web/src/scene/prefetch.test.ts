import { describe, expect, it } from 'vitest'

import { advancePlayhead, advanceSteadyPlayhead, createSymlogScale } from '@/timeline'
import { EARTH_FORMATION, type GeoTime, type Playback } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { scenePlaybackSegments } from './pacing'
import {
  DECODE_AHEAD_SCENES,
  FETCH_AHEAD_SCENES,
  planScenePrefetch,
  PREFETCH_LOOKAHEAD_SECONDS,
  type PlaybackHeading,
} from './prefetch'
import { sceneAt } from './scene'
import { sceneTerritories } from './steadyPacing'

function scene(index: number, t: GeoTime): Scene {
  return {
    id: `s${index}`,
    t,
    chapterId: 'ch',
    image: `s${index}.webp`,
    thumbnail: `s${index}-thumb.webp`,
    shot: 'WIDE_RIDGE',
    title: `s${index}`,
    caption: '',
    width: 2752,
    height: 1536,
  }
}

/** 60 scenes ten years apart: 0, 10, ..., 590. */
const evenScenes: Scene[] = Array.from({ length: 60 }, (_, i) => scene(i, i * 10))

function pairAt(scenes: readonly Scene[], t: GeoTime): [number, number] {
  const { from, to } = sceneAt(scenes, t)
  return [scenes.indexOf(from), scenes.indexOf(to)]
}

function steadyHeading(scenes: readonly Scene[], t: GeoTime, yearsPerSecond: number): PlaybackHeading {
  const playback: Playback = { playing: true, mode: 'steady', yearsPerSecond, speed: 1, baseRate: 0.02 }
  return { t, horizonT: advanceSteadyPlayhead(t, PREFETCH_LOOKAHEAD_SECONDS, playback, sceneTerritories(scenes)) }
}

function planAt(scenes: readonly Scene[], t: GeoTime, heading: PlaybackHeading | null) {
  const [from, to] = pairAt(scenes, t)
  return planScenePrefetch(scenes, from, to, heading)
}

describe('planScenePrefetch — paused or scrubbing', () => {
  it('decodes one scene either side of the pair and fetches nothing else', () => {
    expect(planAt(evenScenes, 300, null)).toEqual({ decode: [29, 31], fetch: [] })
  })

  it('decodes one scene either side of a mid-dissolve pair', () => {
    expect(planAt(evenScenes, 305, null)).toEqual({ decode: [29, 32], fetch: [] })
  })

  it.each([
    ['the present', 0, [1]],
    ['the oldest scene', 590, [58]],
  ])('decodes only the one neighbour that exists at %s', (_label, t, decode) => {
    expect(planAt(evenScenes, t, null)).toEqual({ decode, fetch: [] })
  })

  it('treats a heading that does not move as paused', () => {
    expect(planAt(evenScenes, 300, { t: 300, horizonT: 300 })).toEqual({ decode: [29, 31], fetch: [] })
  })
})

describe('planScenePrefetch — playing toward the present', () => {
  it('orders the decode tier ahead first, then the scene behind', () => {
    const plan = planAt(evenScenes, 300, { t: 300, horizonT: 200 })

    expect(plan.decode).toEqual([29, 28, 27, 31])
  })

  it('fetches the rest of the lookahead in playback order, then one more behind', () => {
    const plan = planAt(evenScenes, 300, { t: 300, horizonT: 250 })

    expect(plan.fetch).toEqual([26, 25, 32])
  })

  it('reads ahead no further than the scene the horizon pair dissolves toward', () => {
    const plan = planAt(evenScenes, 300, { t: 300, horizonT: 265 })

    expect([...plan.decode, ...plan.fetch]).not.toContain(25)
    expect(plan.fetch).toContain(26)
  })

  it('decodes only the next scene when playback will not reach a second within the lookahead', () => {
    const plan = planAt(evenScenes, 300, { t: 300, horizonT: 299 })

    expect(plan).toEqual({ decode: [29, 31], fetch: [32] })
  })

  it('caps the lookahead however far the horizon reaches', () => {
    const plan = planAt(evenScenes, 590, { t: 590, horizonT: 0 })
    const ahead = [...plan.decode, ...plan.fetch].filter((index) => index < 59)

    expect(ahead).toHaveLength(DECODE_AHEAD_SCENES + FETCH_AHEAD_SCENES)
    expect(ahead[0]).toBe(58)
  })

  it('stops at the newest scene near the present', () => {
    const plan = planAt(evenScenes, 20, { t: 20, horizonT: 0 })

    expect(plan).toEqual({ decode: [1, 0, 3], fetch: [4] })
  })

  it('never lists the pair itself or an index twice', () => {
    for (const t of [3, 17, 150, 305, 444, 587]) {
      const [from, to] = pairAt(evenScenes, t)
      const plan = planScenePrefetch(evenScenes, from, to, { t, horizonT: Math.max(0, t - 200) })
      const all = [...plan.decode, ...plan.fetch]

      expect(new Set(all).size).toBe(all.length)
      expect(all).not.toContain(from)
      expect(all).not.toContain(to)
    }
  })
})

describe('planScenePrefetch — playing into the past', () => {
  it('reads ahead up the indices and keeps one scene behind toward the present', () => {
    const plan = planAt(evenScenes, 300, { t: 300, horizonT: 350 })

    expect(plan.decode).toEqual([31, 32, 33, 29])
    expect(plan.fetch).toEqual([34, 35, 28])
  })
})

describe('planScenePrefetch — steady playback rate', () => {
  function aheadCount(yearsPerSecond: number): number {
    const plan = planAt(evenScenes, 400, steadyHeading(evenScenes, 400, yearsPerSecond))
    return [...plan.decode, ...plan.fetch].filter((index) => index < 40).length
  }

  it('reads further ahead at a faster rate', () => {
    expect(aheadCount(2)).toBe(1)
    expect(aheadCount(10)).toBe(3)
    expect(aheadCount(20)).toBe(6)
  })

  it('reads only as far as the per-scene dwell floor lets playback go', () => {
    // At 1,000 yr/s the floor holds each ten-year scene for 0.35 s, so three seconds cross about
    // nine scenes, not the hundred years' worth the requested rate alone would.
    const count = aheadCount(1000)

    expect(count).toBeGreaterThanOrEqual(Math.floor(PREFETCH_LOOKAHEAD_SECONDS / 0.35))
    expect(count).toBeLessThanOrEqual(Math.ceil(PREFETCH_LOOKAHEAD_SECONDS / 0.35) + 1)
  })
})

describe('planScenePrefetch — scenes-mode pacing', () => {
  const fullScale = createSymlogScale([0, EARTH_FORMATION])
  const segments = scenePlaybackSegments(evenScenes)

  function aheadCount(speed: number): number {
    const playback: Playback = { playing: true, mode: 'scenes', speed, yearsPerSecond: 1, baseRate: 0.02 }
    const t = 400
    const horizonT = advancePlayhead(t, PREFETCH_LOOKAHEAD_SECONDS, playback, fullScale, segments)
    const plan = planAt(evenScenes, t, { t, horizonT })
    return [...plan.decode, ...plan.fetch].filter((index) => index < 40).length
  }

  it('decodes one scene ahead at the ordinary pace, several seconds per scene', () => {
    expect(aheadCount(1)).toBe(1)
  })

  it('reads ahead to the cap at the fastest pace', () => {
    expect(aheadCount(64)).toBe(DECODE_AHEAD_SCENES + FETCH_AHEAD_SCENES)
  })
})
