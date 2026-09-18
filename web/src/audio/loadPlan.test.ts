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

function stem(id: string, overrides: Partial<AudioStem> = {}): AudioStem {
  return {
    id,
    file: `${id}.mp3`,
    title: id,
    author: 'test',
    licence: 'CC0 1.0',
    sourceUrl: 'https://example.com',
    durationSeconds: 30,
    loopSafe: true,
    levelTrimDb: 0,
    ...overrides,
  }
}

// Every catalogued stem, so "filtered to the manifest" tests have something to filter *out of*
// rather than accidentally testing an empty catalogue.
const ALL_STEMS: AudioStem[] = [...AMBIENCE_STEM_IDS, ...SCENE_STEM_IDS].map((id) => stem(id))

function scene(id: string, t: number, sound?: SceneSound): Scene {
  return {
    id,
    t,
    chapterId: 'test',
    image: `${id}.jpg`,
    thumbnail: `${id}-thumb.jpg`,
    shot: 'WIDE_RIDGE',
    title: id,
    caption: '',
    width: 1,
    height: 1,
    ...(sound === undefined ? {} : { sound }),
  }
}

function baseInput(overrides: Partial<StemsNeededInput> = {}): StemsNeededInput {
  return {
    t: 0,
    playback: PAUSED,
    sectionWindow: FULL_DOMAIN,
    scenes: [],
    audioStems: ALL_STEMS,
    flatBasaltWindows: [],
    ...overrides,
  }
}

describe('lookaheadWindow', () => {
  it('is a small, symmetric margin around t (in the full-domain scale\'s u) while not playing', () => {
    const window = lookaheadWindow(1e8, PAUSED, FULL_DOMAIN)
    expect(window.tMin).toBeLessThan(1e8)
    expect(window.tMax).toBeGreaterThan(1e8)
    const uAtT = FULL_DOMAIN_SCALE.toUnit(1e8)
    const below = FULL_DOMAIN_SCALE.toUnit(window.tMin) - uAtT
    const above = uAtT - FULL_DOMAIN_SCALE.toUnit(window.tMax)
    expect(below).toBeCloseTo(above, 6)
  })

  it('never expands with speed while not playing — direction is unknowable from t alone', () => {
    const slow = lookaheadWindow(1e8, { ...PAUSED, speed: 1 }, FULL_DOMAIN)
    const fast = lookaheadWindow(1e8, { ...PAUSED, speed: 64 }, FULL_DOMAIN)
    expect(slow).toEqual(fast)
  })

  it('reaches further toward the present than into the past while playing', () => {
    const window = lookaheadWindow(1e8, PLAYING, FULL_DOMAIN)
    const towardPresent = 1e8 - window.tMin
    const towardPast = window.tMax - 1e8
    expect(towardPresent).toBeGreaterThan(towardPast)
  })

  it('grows with speed while playing', () => {
    const slow = lookaheadWindow(1e8, { ...PLAYING, speed: 1 }, FULL_DOMAIN)
    const fast = lookaheadWindow(1e8, { ...PLAYING, speed: 32 }, FULL_DOMAIN)
    expect(1e8 - fast.tMin).toBeGreaterThan(1e8 - slow.tMin)
  })

  it('never reaches past the selected section window even at extreme speed deep in time', () => {
    const section: [number, number] = [1e9, 2e9]
    const window = lookaheadWindow(1.5e9, { playing: true, baseRate: 0.02, speed: 64, mode: 'scenes' }, section)
    expect(window.tMin).toBeGreaterThanOrEqual(section[0])
    expect(window.tMax).toBeLessThanOrEqual(section[1])
  })

  it('always contains t itself, even when the clamped window collapses at a section edge', () => {
    const section: [number, number] = [0, 1e6]
    const window = lookaheadWindow(0, PLAYING, section)
    expect(window.tMin).toBeLessThanOrEqual(0)
    expect(window.tMax).toBeGreaterThanOrEqual(0)
  })

  // Re-review fix: the previous window advanced raw log1p(t) by baseRate*speed seconds, as if
  // that were the same space Playback.baseRate is denominated in (it isn't — baseRate is
  // screen-space u over the *warped, knee'd, normalised* full-domain scale). These pin the
  // window against what advancePlayhead itself actually does, in both playback modes.
  it('reaches at least as far as advancePlayhead moves t in the lookahead span, scenes mode', () => {
    const t = 5e6
    const window = lookaheadWindow(t, PLAYING, FULL_DOMAIN)
    const predicted = advancePlayhead(t, PLAYING_LOOKAHEAD_SECONDS, PLAYING, FULL_DOMAIN_SCALE, [])
    expect(window.tMin).toBeLessThanOrEqual(predicted)
  })

  it('reaches at least as far as advancePlayhead moves t in the lookahead span, steady mode', () => {
    const steady: Playback = { playing: true, baseRate: 0.02, speed: 1, mode: 'steady' }
    const t = 5e6
    const section: [number, number] = [0, 1e8]
    const window = lookaheadWindow(t, steady, section)
    const predicted = advancePlayhead(t, PLAYING_LOOKAHEAD_SECONDS, steady, createSymlogScale(section), [])
    expect(window.tMin).toBeLessThanOrEqual(predicted)
    expect(window.tMin).toBeGreaterThanOrEqual(section[0])
  })

  it('reaches meaningfully further at typical playback speed than a few raw seconds of t (regression: the unit-mismatch bug)', () => {
    // At 1x, PLAYING_LOOKAHEAD_SECONDS (6s) of real playback covers a large fraction of the
    // full symlog domain from a mid-timeline t — the previous (buggy) window advanced t by a
    // few hundredths of one *year*, not a meaningful lookahead.
    const t = 1e8
    const window = lookaheadWindow(t, PLAYING, FULL_DOMAIN)
    expect(t - window.tMin).toBeGreaterThan(1e6)
  })
})

describe('stemsNeeded — ambience curves', () => {
  it('never includes a stem whose gain is 0 throughout the window (pre-land Hadean, paused)', () => {
    // 4.4 Ga: only the pre-land bed (wind/water/storm/volcanic) is ever nonzero — every
    // terrestrial-life stem is 0 by construction this early (stemGains.ts's own ramps all
    // start well after 4.7e8).
    const needed = stemsNeeded(baseInput({ t: 4.4e9 }))
    const stillDormant: StemId[] = ['forest', 'wing-hum', 'insects', 'large-animal', 'birds', 'archosaurs', 'mammals', 'livestock', 'fire', 'settlement', 'industry', 'traffic']
    for (const id of stillDormant) {
      expect(needed.has(id)).toBe(false)
    }
  })

  it('includes the pre-land bed at 4.4 Ga, paused', () => {
    const needed = stemsNeeded(baseInput({ t: 4.4e9 }))
    expect(needed.has('wind')).toBe(true)
    expect(needed.has('water')).toBe(true)
    expect(needed.has('volcanic')).toBe(true)
  })

  it('never includes a stem whose gain is 0 throughout the window (present day, paused)', () => {
    // t=0: wind/water/storm/volcanic and every pre-Cenozoic megafauna stem are 0
    // (stemGains.ts: the terrestrial bed fully faded, archosaurs and large-animal both long
    // recessed to 0 by the K-Pg boundary).
    const needed = stemsNeeded(baseInput({ t: 0 }))
    const shouldBeZero: StemId[] = ['wind', 'water', 'storm', 'volcanic', 'archosaurs', 'large-animal']
    for (const id of shouldBeZero) {
      expect(needed.has(id)).toBe(false)
    }
  })

  it('only includes stems present in the published manifest', () => {
    const needed = stemsNeeded(baseInput({ t: 4.4e9, audioStems: [] }))
    expect(needed.size).toBe(0)
  })

  it('catches a narrow bump inside a wide-enough lookahead window (LGM wind bump at 20 ka)', () => {
    // The LGM wind bump peaks at exactly 20 ka and falls to 0 by 19 ka/26.5 ka either side —
    // narrow relative to the domain, but resolvable if the window reaches it.
    const needed = stemsNeeded(baseInput({ t: 2.1e4, playback: PLAYING, sectionWindow: [0, 3e4] }))
    expect(needed.has('wind')).toBe(true)
  })

  it('does not include wing-hum before its 325-320 Ma ramp starts, paused', () => {
    // wing-hum is 0 before its own ramp starts (stemGains.test.ts), so a paused playhead well
    // before it should never see it loaded. (Not tested at t=0: wing-hum's duck against
    // humanDominance never reaches exactly 0 -- stemGains.ts's own wingHum() doc comment: it
    // persists, rather than receding, once `insects` starts at 300 Ma -- so the idle window's own
    // small margin can tip a sample just over GAIN_THRESHOLD there; that is the loader correctly
    // tracking a curve that is genuinely, if very quietly, nonzero.)
    for (const t of [4.4e9, 3.46e8]) {
      const needed = stemsNeeded(baseInput({ t }))
      expect(needed.has('wing-hum'), `t=${t}`).toBe(false)
    }
  })

  it('includes wing-hum once the playhead nears its ramp, and keeps it once it persists past 300 Ma', () => {
    for (const t of [3.2e8, 3.1e8, 2.9e8]) {
      const needed = stemsNeeded(baseInput({ t }))
      expect(needed.has('wing-hum'), `t=${t}`).toBe(true)
    }
  })
})

describe('stemsNeeded — scene sounds', () => {
  const onceSound: SceneSound = { stem: 'impact', mode: 'once', gain: 0.9 }
  const loopSound: SceneSound = { stem: 'geothermal', mode: 'loop', gain: 0.8 }

  it('includes a scene stem whose scene t falls inside the window', () => {
    const needed = stemsNeeded(
      baseInput({
        t: 1000,
        playback: PAUSED,
        scenes: [scene('near', 1000.5, onceSound)],
      }),
    )
    expect(needed.has('impact')).toBe(true)
  })

  it('excludes a scene stem whose scene t falls well outside even the wider once-mode window', () => {
    const needed = stemsNeeded(
      baseInput({
        t: 1000,
        playback: PAUSED,
        scenes: [scene('far', 5e8, onceSound)],
      }),
    )
    expect(needed.has('impact')).toBe(false)
  })

  it('ignores scenes with no sound', () => {
    // Scene-only stems (no `stemGains` row) can only ever enter the result via a scene's own
    // `sound` — at 4.4 Ga, paused, with a soundless scene, none should appear.
    const needed = stemsNeeded(baseInput({ t: 4.4e9, scenes: [scene('silent', 4.4e9)] }))
    for (const id of SCENE_STEM_IDS) expect(needed.has(id)).toBe(false)
  })

  it('excludes a scene stem not present in the published catalogue', () => {
    const needed = stemsNeeded(
      baseInput({
        t: 1000,
        playback: PAUSED,
        scenes: [scene('near', 1000.5, onceSound)],
        audioStems: ALL_STEMS.filter((s) => s.id !== 'impact'),
      }),
    )
    expect(needed.has('impact')).toBe(false)
  })

  // Re-review fix: a scene's own loop-mode stem must be needed for the whole span the scene is
  // *presented* on screen — sceneAt holds a scene dominant from partway through the dissolve in
  // from the previous scene until partway through the dissolve out to the next one, not merely
  // at its own `t`.
  it('includes a loop-mode scene stem while the scene is presented, well before/after its own t', () => {
    const scenes = [scene('a', 0, loopSound), scene('b', 1_000_000)]
    // sceneAt dissolves between two scenes centred on the *log1p*-space midpoint of the gap
    // (scene/scene.ts's DISSOLVE_WIDTH), not the raw-years midpoint — `a` (t=0) is still
    // strongly dominant here (mix ~= 0.5), a long way past its own t=0 in raw years.
    const logMidpoint = Math.expm1((Math.log1p(0) + Math.log1p(1_000_000)) / 2)
    const needed = stemsNeeded(baseInput({ t: logMidpoint, playback: PAUSED, scenes }))
    expect(needed.has('geothermal')).toBe(true)
  })

  it('fetches an about-to-fire once-mode stem ahead of an ambience stem at the same distance', () => {
    const needed = stemsNeeded(
      baseInput({
        t: 4.4e9, // pre-land bed (wind/water/storm/volcanic) is active here too
        playback: PAUSED,
        scenes: [scene('impact-scene', 4.4e9 + 1, onceSound)],
      }),
    )
    const order = [...needed]
    expect(order.indexOf('impact')).toBeLessThan(order.indexOf('wind'))
  })

  it('reaches further for a once-mode scene stem than the ordinary ambience window (ONCE_LOOKAHEAD_SECONDS)', () => {
    expect(ONCE_LOOKAHEAD_SECONDS).toBeGreaterThan(PLAYING_LOOKAHEAD_SECONDS)
    const t = 1e8
    const ordinary = lookaheadWindow(t, PLAYING, FULL_DOMAIN)
    const sceneArrival = lookaheadWindow(t, PLAYING, FULL_DOMAIN, [], ONCE_LOOKAHEAD_SECONDS)
    expect(t - sceneArrival.tMin).toBeGreaterThan(t - ordinary.tMin)
  })
})

describe('stemsNeeded — property: every audible stem is needed', () => {
  // Re-review fix (finding: "every stem audible at t is needed"): checks the converse of the
  // existing "never a zero-gain stem" tests — that a stem actually above threshold *right now*
  // is never left out, paused or playing, with or without scenes in the mix. `t` is always one
  // of `stemsNeeded`'s own sample points, so this should hold exactly, not just approximately.
  const checkpoints = [4.5e9, 4.4e9, 3.5e9, 1e9, 5e8, 2.5e8, 6.6e7, 1e7, 1e6, 1e5, 2e4, 1e3, 100, 0]

  it('every ambience stem above the gain threshold at t is included (paused)', () => {
    for (const t of checkpoints) {
      const needed = stemsNeeded(baseInput({ t }))
      const gains = stemGains(t, [])
      for (const id of AMBIENCE_STEM_IDS) {
        if (gains[id] > 0.01) expect(needed.has(id), `t=${t} ${id} gain=${gains[id]}`).toBe(true)
      }
    }
  })

  it('every ambience stem above the gain threshold at t is included (playing, 8x)', () => {
    const fast: Playback = { playing: true, baseRate: 0.02, speed: 8, mode: 'scenes' }
    for (const t of checkpoints) {
      const needed = stemsNeeded(baseInput({ t, playback: fast }))
      const gains = stemGains(t, [])
      for (const id of AMBIENCE_STEM_IDS) {
        if (gains[id] > 0.01) expect(needed.has(id), `t=${t} ${id} gain=${gains[id]}`).toBe(true)
      }
    }
  })

  it('a scene\'s loop stem above threshold at t is included, wherever the scene sits relative to its neighbours', () => {
    const loopSound: SceneSound = { stem: 'geothermal', mode: 'loop', gain: 0.7 }
    const scenes = [scene('before', 5e8, undefined), scene('mid', 1e8, loopSound), scene('after', 1e7, undefined)]
    // Sample across and beyond the dissolve bands on both sides of `mid`.
    for (const t of [3e8, 1.5e8, 1.1e8, 1e8, 9e7, 5e7, 2e7]) {
      const needed = stemsNeeded(baseInput({ t, playback: PAUSED, scenes }))
      // Whether it's actually above threshold at this t is exactly what sceneAt/sceneSoundLoopGains
      // decide — this test only asserts stemsNeeded agrees with that pure computation, not a
      // hand-picked expectation of where the dissolve bands fall.
      const gain = sceneSoundLoopGains(sceneAt(scenes, t)).geothermal ?? 0
      if (gain > 0.01) expect(needed.has('geothermal'), `t=${t} gain=${gain}`).toBe(true)
    }
  })
})
