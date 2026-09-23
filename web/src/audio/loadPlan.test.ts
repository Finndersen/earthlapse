import { describe, expect, it } from 'vitest'

import { advancePlayhead, createSymlogScale } from '@/timeline'
import { EARTH_FORMATION } from '@/types/layer'
import type { Playback } from '@/types/layer'
import type { AudioStem, Scene, SceneSound } from '@/types/manifest'

import { sceneAt } from '@/scene'

import { lookaheadWindow, ONCE_LOOKAHEAD_SECONDS, PLAYING_LOOKAHEAD_SECONDS, stemsNeeded, type StemsNeededInput } from './loadPlan'
import { sceneSoundLoopGains } from './sceneSound'
import { stemGains } from './stemGains'
import { AMBIENCE_STEM_IDS, SCENE_STEM_IDS, type StemId } from './stemIds'

const FULL_DOMAIN: [number, number] = [0, EARTH_FORMATION]
const FULL_DOMAIN_SCALE = createSymlogScale(FULL_DOMAIN)

const PAUSED: Playback = { playing: false, baseRate: 0.02, speed: 1, mode: 'scenes' }
const PLAYING: Playback = { playing: true, baseRate: 0.02, speed: 1, mode: 'scenes' }

const ALL_STEMS: AudioStem[] = [...AMBIENCE_STEM_IDS, ...SCENE_STEM_IDS].map((id) => ({
  id,
  file: `${id}.mp3`,
  title: id,
  author: 'test',
  licence: 'CC0 1.0',
  sourceUrl: 'https://example.com',
  durationSeconds: 30,
  loopSafe: true,
  levelTrimDb: 0,
}))

function scene(id: string, t: number, sound?: SceneSound): Scene {
  return { id, t, chapterId: 'test', image: `${id}.jpg`, thumbnail: `${id}-t.jpg`, shot: 'WIDE_RIDGE', title: id, caption: '', width: 1, height: 1, ...(sound ? { sound } : {}) }
}

function needed(overrides: Partial<StemsNeededInput> = {}): ReadonlySet<StemId> {
  return stemsNeeded({ t: 0, playback: PAUSED, sectionWindow: FULL_DOMAIN, scenes: [], audioStems: ALL_STEMS, flatBasaltWindows: [], ...overrides })
}

describe('lookaheadWindow', () => {
  it('is symmetric in u around t while paused, independent of speed', () => {
    const window = lookaheadWindow(1e8, PAUSED, FULL_DOMAIN)
    const u = FULL_DOMAIN_SCALE.toUnit(1e8)
    expect(FULL_DOMAIN_SCALE.toUnit(window.tMin) - u).toBeCloseTo(u - FULL_DOMAIN_SCALE.toUnit(window.tMax), 6)
    expect(lookaheadWindow(1e8, { ...PAUSED, speed: 64 }, FULL_DOMAIN)).toEqual(window)
  })

  it('reaches further toward the present while playing, growing with speed', () => {
    const slow = lookaheadWindow(1e8, PLAYING, FULL_DOMAIN)
    expect(1e8 - slow.tMin).toBeGreaterThan(slow.tMax - 1e8)
    expect(1e8 - lookaheadWindow(1e8, { ...PLAYING, speed: 32 }, FULL_DOMAIN).tMin).toBeGreaterThan(1e8 - slow.tMin)
  })

  it.each([
    ['scenes', FULL_DOMAIN],
    ['steady', [0, 1e8]],
  ] as const)('covers at least where advancePlayhead goes in %s mode', (mode, section) => {
    const pb: Playback = { ...PLAYING, mode }
    const window = lookaheadWindow(5e6, pb, [...section])
    expect(window.tMin).toBeLessThanOrEqual(advancePlayhead(5e6, PLAYING_LOOKAHEAD_SECONDS, pb, createSymlogScale([...section]), []))
  })

  it('stays inside the section window yet always contains t', () => {
    const window = lookaheadWindow(1.5e9, { ...PLAYING, speed: 64 }, [1e9, 2e9])
    expect(window.tMin).toBeGreaterThanOrEqual(1e9)
    expect(window.tMax).toBeLessThanOrEqual(2e9)
    const edge = lookaheadWindow(0, PLAYING, [0, 1e6])
    expect(edge.tMin).toBeLessThanOrEqual(0)
    expect(edge.tMax).toBeGreaterThanOrEqual(0)
  })

  it('reaches further for once-mode arrivals', () => {
    expect(ONCE_LOOKAHEAD_SECONDS).toBeGreaterThan(PLAYING_LOOKAHEAD_SECONDS)
    expect(lookaheadWindow(1e8, PLAYING, FULL_DOMAIN, [], ONCE_LOOKAHEAD_SECONDS).tMin).toBeLessThan(lookaheadWindow(1e8, PLAYING, FULL_DOMAIN).tMin)
  })
})

describe('stemsNeeded', () => {
  const checkpoints = [4.5e9, 4.4e9, 1e9, 2.5e8, 6.6e7, 1e6, 2e4, 100, 0]

  it.each([
    ['paused', PAUSED],
    ['playing 8x', { ...PLAYING, speed: 8 }],
  ])('includes every ambience stem audible at t (%s)', (_label, playback) => {
    for (const t of checkpoints) {
      const set = needed({ t, playback })
      const gains = stemGains(t, [])
      for (const id of AMBIENCE_STEM_IDS) if (gains[id] > 0.01) expect(set.has(id), `t=${t} ${id}`).toBe(true)
    }
  })

  it('omits stems silent throughout the window, and anything not in the manifest', () => {
    const hadean = needed({ t: 4.4e9 })
    for (const id of ['forest', 'insects', 'mammals', 'traffic'] as StemId[]) expect(hadean.has(id)).toBe(false)
    const present = needed({ t: 0 })
    for (const id of ['wind', 'volcanic', 'archosaurs'] as StemId[]) expect(present.has(id)).toBe(false)
    expect(needed({ t: 4.4e9, audioStems: [] }).size).toBe(0)
  })

  it('catches a narrow gain bump the lookahead reaches', () => {
    expect(needed({ t: 2.1e4, playback: PLAYING, sectionWindow: [0, 3e4] }).has('wind')).toBe(true)
  })

  describe('scene sounds', () => {
    const once: SceneSound = { stem: 'impact', mode: 'once', gain: 0.9 }
    const loop: SceneSound = { stem: 'geothermal', mode: 'loop', gain: 0.7 }

    it('includes a scene stem only when its scene is near, catalogued and has a sound', () => {
      expect(needed({ t: 1000, scenes: [scene('near', 1000.5, once)] }).has('impact')).toBe(true)
      expect(needed({ t: 1000, scenes: [scene('far', 5e8, once)] }).has('impact')).toBe(false)
      expect(needed({ t: 1000, scenes: [scene('near', 1000.5, once)], audioStems: ALL_STEMS.filter((s) => s.id !== 'impact') }).has('impact')).toBe(false)
      const silent = needed({ t: 4.4e9, scenes: [scene('silent', 4.4e9)] })
      for (const id of SCENE_STEM_IDS) expect(silent.has(id)).toBe(false)
    })

    it('fetches an imminent once-mode stem ahead of ambience', () => {
      const order = [...needed({ t: 4.4e9, scenes: [scene('impact', 4.4e9 + 1, once)] })]
      expect(order.indexOf('impact')).toBeLessThan(order.indexOf('wind'))
    })

    it('includes a loop stem wherever its scene is audibly presented', () => {
      const scenes = [scene('before', 5e8), scene('mid', 1e8, loop), scene('after', 1e7)]
      for (const t of [3e8, 1.5e8, 1e8, 5e7, 2e7]) {
        const gain = sceneSoundLoopGains(sceneAt(scenes, t)).geothermal ?? 0
        if (gain > 0.01) expect(needed({ t, scenes }).has('geothermal'), `t=${t}`).toBe(true)
      }
      const logMidpoint = Math.expm1(Math.log1p(1_000_000) / 2)
      expect(needed({ t: logMidpoint, scenes: [scene('a', 0, { ...loop, gain: 0.8 }), scene('b', 1_000_000)] }).has('geothermal')).toBe(true)
    })
  })
})
