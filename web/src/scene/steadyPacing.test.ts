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
const SCENES = [s0, s1, s2, scene('s3', 1e5), scene('s4', 1e6)]
const TERRITORIES = sceneTerritories(SCENES)

describe('sceneTerritories', () => {
  it('is empty with fewer than two scenes', () => {
    expect(sceneTerritories([])).toEqual([])
    expect(sceneTerritories([s0])).toEqual([])
  })

  it('tiles the whole domain, one territory per scene, split at log1p midpoints', () => {
    expect(TERRITORIES).toHaveLength(SCENES.length)
    expect(TERRITORIES[0]!.tNewer).toBe(0)
    expect(TERRITORIES.at(-1)!.tOlder).toBe(EARTH_FORMATION)
    for (let i = 0; i < TERRITORIES.length - 1; i++) expect(TERRITORIES[i]!.tOlder).toBe(TERRITORIES[i + 1]!.tNewer)
    expect(TERRITORIES[1]!.tNewer).toBeCloseTo(tAtLogP(s0.t, s1.t, 0.5), 9)
    expect(TERRITORIES[1]!.tOlder).toBeCloseTo(tAtLogP(s1.t, s2.t, 0.5), 9)
  })
})

describe('territoryAt', () => {
  it('finds the containing territory, clamping outside and resolving a boundary to the older side', () => {
    expect(territoryAt([], 500)).toBeUndefined()
    const inside = territoryAt(TERRITORIES, 150)!
    expect(150).toBeGreaterThanOrEqual(inside.tNewer)
    expect(150).toBeLessThanOrEqual(inside.tOlder)
    expect(territoryAt(TERRITORIES, -1)).toBe(TERRITORIES[0])
    expect(territoryAt(TERRITORIES, EARTH_FORMATION + 1)).toBe(TERRITORIES.at(-1))
    expect(territoryAt(TERRITORIES, TERRITORIES[1]!.tOlder)).toBe(TERRITORIES[2])
  })
})

describe('steadyPacing', () => {
  const unit: SteadySceneTerritory = { tNewer: 0, tOlder: 1 }
  const pace = (dwellSeconds: number) => steadyPacing([unit], 0.5, 1 / dwellSeconds)

  it('crossfades for no territories or a non-positive rate', () => {
    expect(steadyPacing([], 500, 1000)).toEqual({ regime: 'crossfade', floored: false })
    expect(steadyPacing(TERRITORIES, 50, 0)).toEqual({ regime: 'crossfade', floored: false })
  })

  it('crossfades at a dwell of MIN_TRANSITION_SECONDS, cuts below it, and floors below MIN_CUT_DWELL_SECONDS', () => {
    expect(pace(MIN_TRANSITION_SECONDS)).toEqual({ regime: 'crossfade', floored: false })
    expect(pace(MIN_TRANSITION_SECONDS - 0.01)).toEqual({ regime: 'cut', floored: false })
    expect(pace(MIN_CUT_DWELL_SECONDS)).toEqual({ regime: 'cut', floored: false })
    expect(pace(MIN_CUT_DWELL_SECONDS - 0.01)).toEqual({ regime: 'cut', floored: true })
  })

  it('floors a dense cluster at a fast literal rate but not at a slow one', () => {
    expect(steadyPacing(TERRITORIES, s1.t, 4e4)).toEqual({ regime: 'cut', floored: true })
    expect(steadyPacing(TERRITORIES, s1.t, 200).floored).toBe(false)
  })
})

describe('steadyFrameRegime', () => {
  it('matches steadyPacing unless seeked, when it always crossfades', () => {
    expect(steadyFrameRegime(TERRITORIES, s1.t, 4e4, false)).toEqual({ regime: 'cut', floored: true })
    expect(steadyFrameRegime(TERRITORIES, s1.t, 4e4, true)).toEqual({ regime: 'crossfade', floored: false })
  })
})
