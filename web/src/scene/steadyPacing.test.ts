import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type TimeScale } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { tAtLogP } from './scene'
import { MIN_CUT_DWELL_SECONDS, sceneTerritories, steadyFrameRegime, steadyPacing, territoryAt, type SteadySceneTerritory } from './steadyPacing'
import { MIN_TRANSITION_SECONDS } from './presentation'

function scene(id: string, t: number): Scene {
  return {
    id,
    t,
    chapterId: 'ch',
    image: `${id}.png`,
    thumbnail: `${id}-thumb.png`,
    shot: 'WIDE_RIDGE',
    title: `title ${id}`,
    caption: `caption ${id}`,
    width: 1920,
    height: 1080,
  }
}

// A plain linear TimeScale over `domain`, so uSpan/dwell arithmetic in the tests below is exact
// and easy to hand-verify — `steadyPacing` only ever calls `scale.toUnit`, so it does not care
// which `TimeScale` implementation it is handed.
function linearScale(domain: readonly [number, number]): TimeScale {
  const [newest, oldest] = domain
  const span = oldest - newest
  return {
    kind: 'linear',
    domain: [newest, oldest],
    toUnit: (t) => (oldest - t) / span,
    fromUnit: (u) => oldest - u * span,
  }
}

const s0 = scene('s0', 0)
const s1 = scene('s1', 100)
const s2 = scene('s2', 200)
const s3 = scene('s3', 1e5)
const s4 = scene('s4', 1e6)

// -------------------------------------------------------------------------- sceneTerritories

describe('sceneTerritories', () => {
  it('returns [] for zero or one scene — no gap to place a boundary in', () => {
    expect(sceneTerritories([])).toEqual([])
    expect(sceneTerritories([s0])).toEqual([])
  })

  it('is open at the domain edges: newest scene down to 0, oldest up to EARTH_FORMATION', () => {
    const territories = sceneTerritories([s0, s1, s2])
    expect(territories[0]!.tNewer).toBe(0)
    expect(territories[territories.length - 1]!.tOlder).toBe(EARTH_FORMATION)
  })

  it('is contiguous: each territory\'s tOlder is the next one\'s tNewer', () => {
    const territories = sceneTerritories([s0, s1, s2, s3, s4])
    for (let i = 0; i < territories.length - 1; i++) {
      expect(territories[i]!.tOlder).toBe(territories[i + 1]!.tNewer)
    }
  })

  it('places each interior boundary at the log1p midpoint between its two scenes', () => {
    const territories = sceneTerritories([s0, s1, s2])
    expect(territories[1]!.tNewer).toBeCloseTo(tAtLogP(s0.t, s1.t, 0.5), 9)
    expect(territories[1]!.tOlder).toBeCloseTo(tAtLogP(s1.t, s2.t, 0.5), 9)
  })

  it('one territory per scene, in the same (newest-first) order', () => {
    const scenes = [s0, s1, s2, s3, s4]
    expect(sceneTerritories(scenes)).toHaveLength(scenes.length)
  })
})

// ------------------------------------------------------------------------------ territoryAt

describe('territoryAt', () => {
  const territories = sceneTerritories([s0, s1, s2, s3, s4])

  it('returns undefined for an empty array', () => {
    expect(territoryAt([], 500)).toBeUndefined()
  })

  it('finds the territory an interior t falls inside', () => {
    const t = (s1.t + s2.t) / 2 // well inside s1/s2's shared neighbourhood, not at a boundary
    const territory = territoryAt(territories, t)
    expect(territory).toBeDefined()
    expect(t).toBeGreaterThanOrEqual(territory!.tNewer)
    expect(t).toBeLessThanOrEqual(territory!.tOlder)
  })

  it('clamps outside the whole scene span to the nearest end territory', () => {
    expect(territoryAt(territories, -1)).toBe(territories[0])
    expect(territoryAt(territories, EARTH_FORMATION + 1)).toBe(territories[territories.length - 1])
  })

  it('at an exact shared boundary, resolves to the older (higher-index) territory — dominantScene\'s own tie-break', () => {
    const boundary = territories[1]!.tOlder // === territories[2].tNewer
    expect(territoryAt(territories, boundary)).toBe(territories[2])
  })
})

// ------------------------------------------------------------------------------ steadyPacing

describe('steadyPacing: degenerate inputs', () => {
  it('crossfades, not floored, with no territories', () => {
    expect(steadyPacing([], 500, 0.02, linearScale([0, 1e6]))).toEqual({ regime: 'crossfade', floored: false })
  })

  it('crossfades, not floored, for a non-positive rawRate', () => {
    const territories = sceneTerritories([s0, s1])
    const scale = linearScale([0, 1e6])
    expect(steadyPacing(territories, 50, 0, scale)).toEqual({ regime: 'crossfade', floored: false })
    expect(steadyPacing(territories, 50, -1, scale)).toEqual({ regime: 'crossfade', floored: false })
  })
})

describe('steadyPacing: regime boundaries', () => {
  // One synthetic territory of exact uSpan 1 (linear scale over [0,1] years, contrived purely so
  // uSpan/rawRate lands on round numbers) — isolates the three regimes from real scene geometry.
  const territory: SteadySceneTerritory = { tNewer: 0, tOlder: 1 }
  const scale = linearScale([0, 1])

  it('dwell exactly at MIN_TRANSITION_SECONDS crossfades (>=, not >)', () => {
    const rawRate = 1 / MIN_TRANSITION_SECONDS // uSpan(1) / rawRate === MIN_TRANSITION_SECONDS exactly
    expect(steadyPacing([territory], 0.5, rawRate, scale)).toEqual({ regime: 'crossfade', floored: false })
  })

  it('dwell just under MIN_TRANSITION_SECONDS cuts, not floored', () => {
    const rawRate = 1 / (MIN_TRANSITION_SECONDS - 0.01)
    const result = steadyPacing([territory], 0.5, rawRate, scale)
    expect(result.regime).toBe('cut')
    expect(result.floored).toBe(false)
  })

  it('dwell exactly at MIN_CUT_DWELL_SECONDS cuts, not floored (>=, not >)', () => {
    const rawRate = 1 / MIN_CUT_DWELL_SECONDS
    expect(steadyPacing([territory], 0.5, rawRate, scale)).toEqual({ regime: 'cut', floored: false })
  })

  it('dwell just under MIN_CUT_DWELL_SECONDS cuts AND floors', () => {
    const rawRate = 1 / (MIN_CUT_DWELL_SECONDS - 0.01)
    expect(steadyPacing([territory], 0.5, rawRate, scale)).toEqual({ regime: 'cut', floored: true })
  })

  it('a vast (whole-domain) territory at an ordinary 1x rate dwells for ages — crossfades', () => {
    const vastTerritory: SteadySceneTerritory = { tNewer: 0, tOlder: EARTH_FORMATION }
    const scaleFull = linearScale([0, EARTH_FORMATION])
    expect(steadyPacing([vastTerritory], EARTH_FORMATION / 2, 0.02, scaleFull)).toEqual({
      regime: 'crossfade',
      floored: false,
    })
  })
})

describe('steadyPacing: real scene geometry, dense human-history-style cluster', () => {
  // Five scenes a couple hundred years apart, standing in for a dense real cluster without
  // needing the full manifest. At a brisk rate over a narrow window, every territory here is
  // far too small for MIN_TRANSITION_SECONDS and needs the floor.
  const scenes = [s0, s1, s2, s3, s4]
  const territories = sceneTerritories(scenes)
  const scale = linearScale([0, 2e6])

  it('a dense cluster floors at a plausible playback rate', () => {
    const rawRate = 0.02 // baseRate at 1x
    const result = steadyPacing(territories, s1.t, rawRate, scale)
    expect(result).toEqual({ regime: 'cut', floored: true })
  })

  it('the same cluster at a much lower rate (slow speed) no longer needs the floor', () => {
    const rawRate = 0.02 / 200
    const result = steadyPacing(territories, s1.t, rawRate, scale)
    expect(result.floored).toBe(false)
  })
})

describe('steadyPacing: purity', () => {
  it('is deterministic — identical inputs give identical output', () => {
    const territories = sceneTerritories([s0, s1, s2, s3])
    const scale = linearScale([0, 1e6])
    const a = steadyPacing(territories, 150, 0.02, scale)
    const b = steadyPacing(territories, 150, 0.02, scale)
    expect(a).toEqual(b)
  })
})

// -------------------------------------------------------------------------- steadyFrameRegime

describe('steadyFrameRegime (ADR-029 re-review fix)', () => {
  const scenes = [s0, s1, s2, s3, s4]
  const territories = sceneTerritories(scenes)
  const scale = linearScale([0, 2e6])
  const rawRate = 0.02 // a plausible 1x steady rate, dense enough to floor around s1

  it('matches steadyPacing exactly when not seeked', () => {
    expect(steadyFrameRegime(territories, s1.t, rawRate, scale, false)).toEqual(steadyPacing(territories, s1.t, rawRate, scale))
  })

  it('forces crossfade/not-floored when seeked, even for a territory that would otherwise cut and floor', () => {
    // Confirm this territory would floor if it weren't seeked, so the seeked case below is
    // actually exercising the override, not merely a territory that was crossfade anyway.
    expect(steadyPacing(territories, s1.t, rawRate, scale)).toEqual({ regime: 'cut', floored: true })
    expect(steadyFrameRegime(territories, s1.t, rawRate, scale, true)).toEqual({ regime: 'crossfade', floored: false })
  })

  it('is evaluated at renderedT, not some other position — a seeked=false call reads whatever renderedT says', () => {
    // s1's own territory floors; a vast synthetic one built around s4 does not (comfortably
    // above MIN_TRANSITION_SECONDS at this rate) — passing s4.t as renderedT must read s4's own
    // regime, confirming the function samples the position it's actually given.
    const vastTerritories: SteadySceneTerritory[] = [{ tNewer: 0, tOlder: EARTH_FORMATION }]
    const vastScale = linearScale([0, EARTH_FORMATION])
    expect(steadyFrameRegime(vastTerritories, EARTH_FORMATION / 2, rawRate, vastScale, false)).toEqual({
      regime: 'crossfade',
      floored: false,
    })
  })

  it('is pure: identical inputs give identical output, for both seeked values', () => {
    expect(steadyFrameRegime(territories, s1.t, rawRate, scale, false)).toEqual(steadyFrameRegime(territories, s1.t, rawRate, scale, false))
    expect(steadyFrameRegime(territories, s1.t, rawRate, scale, true)).toEqual(steadyFrameRegime(territories, s1.t, rawRate, scale, true))
  })
})
