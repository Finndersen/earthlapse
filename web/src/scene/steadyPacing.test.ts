import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'
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
    expect(steadyPacing([], 500, 1000)).toEqual({ regime: 'crossfade', floored: false })
  })

  it('crossfades, not floored, for a non-positive rate', () => {
    const territories = sceneTerritories([s0, s1])
    expect(steadyPacing(territories, 50, 0)).toEqual({ regime: 'crossfade', floored: false })
    expect(steadyPacing(territories, 50, -1)).toEqual({ regime: 'crossfade', floored: false })
  })
})

describe('steadyPacing: regime boundaries', () => {
  // One synthetic territory exactly 1 year wide, so the dwell is the reciprocal of the rate.
  const territory: SteadySceneTerritory = { tNewer: 0, tOlder: 1 }

  it('dwell exactly at MIN_TRANSITION_SECONDS crossfades (>=, not >)', () => {
    expect(steadyPacing([territory], 0.5, 1 / MIN_TRANSITION_SECONDS)).toEqual({ regime: 'crossfade', floored: false })
  })

  it('dwell just under MIN_TRANSITION_SECONDS cuts, not floored', () => {
    const result = steadyPacing([territory], 0.5, 1 / (MIN_TRANSITION_SECONDS - 0.01))
    expect(result.regime).toBe('cut')
    expect(result.floored).toBe(false)
  })

  it('dwell exactly at MIN_CUT_DWELL_SECONDS cuts, not floored (>=, not >)', () => {
    expect(steadyPacing([territory], 0.5, 1 / MIN_CUT_DWELL_SECONDS)).toEqual({ regime: 'cut', floored: false })
  })

  it('dwell just under MIN_CUT_DWELL_SECONDS cuts AND floors', () => {
    expect(steadyPacing([territory], 0.5, 1 / (MIN_CUT_DWELL_SECONDS - 0.01))).toEqual({ regime: 'cut', floored: true })
  })

  it('a vast (whole-domain) territory at 1 Myr/s dwells for over an hour — crossfades', () => {
    const vastTerritory: SteadySceneTerritory = { tNewer: 0, tOlder: EARTH_FORMATION }
    expect(steadyPacing([vastTerritory], EARTH_FORMATION / 2, 1e6)).toEqual({ regime: 'crossfade', floored: false })
  })
})

describe('steadyPacing: real scene geometry, dense human-history-style cluster', () => {
  // Five scenes a hundred years apart near the present, standing in for a dense real cluster
  // without needing the full manifest.
  const scenes = [s0, s1, s2, s3, s4]
  const territories = sceneTerritories(scenes)

  it('floors a dense cluster at 40 kyr/s', () => {
    expect(steadyPacing(territories, s1.t, 4e4)).toEqual({ regime: 'cut', floored: true })
  })

  it('does not floor the same cluster at 200 yr/s', () => {
    expect(steadyPacing(territories, s1.t, 200).floored).toBe(false)
  })

  it('crossfades the same cluster at 20 yr/s', () => {
    expect(steadyPacing(territories, s1.t, 20)).toEqual({ regime: 'crossfade', floored: false })
  })
})

describe('steadyPacing: purity', () => {
  it('is deterministic — identical inputs give identical output', () => {
    const territories = sceneTerritories([s0, s1, s2, s3])
    expect(steadyPacing(territories, 150, 1e4)).toEqual(steadyPacing(territories, 150, 1e4))
  })
})

// -------------------------------------------------------------------------- steadyFrameRegime

describe('steadyFrameRegime', () => {
  const scenes = [s0, s1, s2, s3, s4]
  const territories = sceneTerritories(scenes)
  const rate = 4e4 // dense enough to floor around s1

  it('matches steadyPacing exactly when not seeked', () => {
    expect(steadyFrameRegime(territories, s1.t, rate, false)).toEqual(steadyPacing(territories, s1.t, rate))
  })

  it('forces crossfade/not-floored when seeked, even for a territory that would otherwise cut and floor', () => {
    expect(steadyPacing(territories, s1.t, rate)).toEqual({ regime: 'cut', floored: true })
    expect(steadyFrameRegime(territories, s1.t, rate, true)).toEqual({ regime: 'crossfade', floored: false })
  })

  it('reads the territory at renderedT', () => {
    const vastTerritories: SteadySceneTerritory[] = [{ tNewer: 0, tOlder: EARTH_FORMATION }]
    expect(steadyFrameRegime(vastTerritories, EARTH_FORMATION / 2, rate, false)).toEqual({ regime: 'crossfade', floored: false })
  })

  it('is pure: identical inputs give identical output, for both seeked values', () => {
    expect(steadyFrameRegime(territories, s1.t, rate, false)).toEqual(steadyFrameRegime(territories, s1.t, rate, false))
    expect(steadyFrameRegime(territories, s1.t, rate, true)).toEqual(steadyFrameRegime(territories, s1.t, rate, true))
  })
})
