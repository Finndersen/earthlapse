import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type Playback, type TimeScale } from '@/types/layer'

import { advancePlayhead, advanceSteadyPlayhead, type PlaybackPacingSegment, type SteadySceneTerritory } from './playback'
import { createLinearScale, createSymlogScale } from './scale'
import { sectionById } from './sections'

const fullScale: TimeScale = createSymlogScale([0, EARTH_FORMATION])
const MIN_CUT_DWELL_SECONDS = 0.35

function playback(overrides: Partial<Playback> = {}): Playback {
  return { playing: true, baseRate: 0.1, speed: 1, yearsPerSecond: 1, mode: 'scenes', ...overrides }
}

function du(t: number, dt: number, pb: Playback, segments?: PlaybackPacingSegment[], scale = fullScale): number {
  return scale.toUnit(advancePlayhead(t, dt, pb, scale, segments)) - scale.toUnit(t)
}

describe('advancePlayhead', () => {
  it('moves toward the present at baseRate × speed × dt in warped space', () => {
    expect(du(1e8, 2, playback({ baseRate: 0.02, speed: 3 }))).toBeCloseTo(0.12, 9)
    const linear = createLinearScale([0, EARTH_FORMATION])
    expect(du(2e9, 5, playback({ baseRate: 0.02 }), undefined, linear)).toBeCloseTo(0.1, 9)
  })

  it('is a no-op when paused or for a non-finite dt', () => {
    expect(advancePlayhead(1e8, 1, playback({ playing: false }), fullScale)).toBe(1e8)
    for (const dt of [Number.NaN, Infinity, -Infinity]) expect(advancePlayhead(1e8, dt, playback(), fullScale)).toBe(1e8)
  })

  it('clamps at the present, finite even at extreme dt', () => {
    expect(advancePlayhead(10, 1e9, playback({ speed: 64 }), fullScale)).toBe(0)
    expect(advancePlayhead(0, 1, playback(), fullScale)).toBe(0)
    expect(advancePlayhead(1e8, Number.MAX_VALUE, playback({ speed: 64 }), fullScale)).toBe(0)
  })

  it('ignores pacing in steady mode, and scenes mode with no pacing moves at the flat rate', () => {
    const segment = { tNewer: 5e7, tOlder: 5.0005e7, durationSeconds: 5 }
    const steady = playback({ mode: 'steady', yearsPerSecond: 1000 })
    expect(advancePlayhead(5.0005e7, 1, steady, fullScale, [segment])).toBe(advancePlayhead(5.0005e7, 1, steady, fullScale))
    expect(advancePlayhead(5.0005e7, 1, playback(), fullScale, [])).toBe(advancePlayhead(5.0005e7, 1, playback(), fullScale))
  })

  describe('scenes mode pacing', () => {
    const segment: PlaybackPacingSegment = { tNewer: 5e7, tOlder: 5.0005e7, durationSeconds: 5 }

    function timeToCross(speed: number): number {
      const pb = playback({ mode: 'scenes', baseRate: 0.05, speed })
      let t = segment.tOlder
      let elapsed = 0
      const dt = segment.durationSeconds / (500 * speed)
      while (t > segment.tNewer && elapsed < 40) {
        t = advancePlayhead(t, dt, pb, fullScale, [segment])
        elapsed += dt
      }
      return elapsed
    }

    it('crosses a dense segment in exactly its duration, divided by speed', () => {
      const pb = playback({ mode: 'scenes', baseRate: 0.05 })
      expect(fullScale.toUnit(advancePlayhead(segment.tOlder, 5, pb, fullScale, [segment]))).toBeCloseTo(fullScale.toUnit(segment.tNewer), 9)
      expect(timeToCross(1)).toBeCloseTo(5, 1)
      expect(timeToCross(8)).toBeCloseTo(timeToCross(1) / 8, 2)
    })

    it('crosses a sparse gap faster than baseRate, uncapped', () => {
      const sparse = { tNewer: 1e6, tOlder: 1e9, durationSeconds: 0.001 }
      const expected = (fullScale.toUnit(sparse.tNewer) - fullScale.toUnit(sparse.tOlder)) / sparse.durationSeconds
      expect(du(5e8, 1e-6, playback({ mode: 'scenes', baseRate: 0.02 }), [sparse]) / 1e-6).toBeCloseTo(expected, 3)
      expect(expected).toBeGreaterThan(0.2)
    })

    it('moves at the flat rate outside every segment', () => {
      const pb = playback({ mode: 'scenes', baseRate: 0.03, speed: 2 })
      expect(du(1e9, 1e-6, pb, [{ tNewer: 5e8, tOlder: 6e8, durationSeconds: 0.001 }])).toBeCloseTo(0.06e-6, 9)
    })

    it('gives the same result for one huge step as for many small ones', () => {
      const segments = [
        { tNewer: 3e8, tOlder: 3.5e8, durationSeconds: 2 },
        { tNewer: 2.5e8, tOlder: 3e8, durationSeconds: 3 },
        { tNewer: 2e8, tOlder: 2.5e8, durationSeconds: 1.5 },
      ]
      const pb = playback({ mode: 'scenes', baseRate: 0.05 })
      let many = 4e8
      for (let i = 0; i < 4000; i++) many = advancePlayhead(many, 20 / 4000, pb, fullScale, segments)
      expect(fullScale.toUnit(advancePlayhead(4e8, 20, pb, fullScale, segments))).toBeCloseTo(fullScale.toUnit(many), 4)
    })

    it('does not stall on a zero-width segment', () => {
      const segments = [
        { tNewer: 5e7, tOlder: 5e7, durationSeconds: 5 },
        { tNewer: 4e7, tOlder: 4.5e7, durationSeconds: 1 },
      ]
      expect(advancePlayhead(6e7, 3, playback({ mode: 'scenes', baseRate: 0.05 }), fullScale, segments)).toBeLessThan(6e7)
    })
  })
})

describe('advanceSteadyPlayhead', () => {
  const steady = (yearsPerSecond: number, overrides: Partial<Playback> = {}): Playback => playback({ mode: 'steady', yearsPerSecond, ...overrides })

  it('moves t by yearsPerSecond × dt years, whatever the scale, section or section edge', () => {
    for (const [t, rate] of [
      [150, 10],
      [30e6, 5e5],
      [2e9, 5e7],
    ] as const) {
      expect(advanceSteadyPlayhead(t, 0.5, steady(rate))).toBeCloseTo(t - rate * 0.5, 6)
    }
    expect(advancePlayhead(1e6, 2, steady(500), fullScale)).toBe(1e6 - 1000)
    expect(advancePlayhead(1e6, 2, steady(500), createLinearScale([0, EARTH_FORMATION]))).toBe(1e6 - 1000)
    const industrial = sectionById('industrial-age').window
    expect(advanceSteadyPlayhead(industrial[0] + 5, 2, steady(5))).toBeCloseTo(industrial[0] - 5, 9)
    expect(advanceSteadyPlayhead(1, 1000, steady(10))).toBe(0)
  })

  it('is a no-op when paused, for zero dt or a non-positive rate, and rejects scenes mode', () => {
    expect(advanceSteadyPlayhead(150, 1, steady(10, { playing: false }))).toBe(150)
    expect(advanceSteadyPlayhead(150, 0, steady(10))).toBe(150)
    expect(advanceSteadyPlayhead(150, 1, steady(0))).toBe(150)
    expect(() => advanceSteadyPlayhead(150, 1, playback({ mode: 'scenes' }))).toThrow(/steady/)
  })

  describe('scene territory floor', () => {
    function dwell(from: number, to: number, rate: number, territories: SteadySceneTerritory[]): number {
      let t = from
      let elapsed = 0
      for (let i = 0; i < 5_000_000 && t > to; i++) {
        t = advanceSteadyPlayhead(t, 0.001, steady(rate), territories)
        elapsed += 0.001
      }
      return elapsed
    }

    it('floors a narrow territory to the minimum dwell at every rate', () => {
      const territories = [
        { tNewer: 0, tOlder: 100 },
        { tNewer: 100, tOlder: 200 },
        { tNewer: 200, tOlder: EARTH_FORMATION },
      ]
      for (const rate of [500, 1e4, 1e9]) expect(dwell(200, 100, rate, territories)).toBeGreaterThanOrEqual(MIN_CUT_DWELL_SECONDS - 0.01)
    })

    it('never skips a territory in a dense run', () => {
      const territories = Array.from({ length: 20 }, (_, i) => ({ tNewer: i * 2, tOlder: (i + 1) * 2 }))
      territories.push({ tNewer: 40, tOlder: EARTH_FORMATION })
      expect(dwell(40, 0, 1e6, territories)).toBeGreaterThanOrEqual(20 * (MIN_CUT_DWELL_SECONDS - 0.01))
    })

    it('prorates a territory entered mid-way, then floors the next one fully', () => {
      const territories = [
        { tNewer: 0, tOlder: 50 },
        { tNewer: 50, tOlder: 100 },
        { tNewer: 100, tOlder: EARTH_FORMATION },
      ]
      const entered = dwell(55, 50, 1e4, territories)
      expect(entered).toBeGreaterThan(0)
      expect(entered).toBeLessThan(MIN_CUT_DWELL_SECONDS)
      expect(dwell(50, 0, 1e4, territories)).toBeGreaterThanOrEqual(MIN_CUT_DWELL_SECONDS - 0.01)
    })

    it('leaves wide territories and an empty list at the requested rate', () => {
      const t0 = EARTH_FORMATION / 2
      expect(advanceSteadyPlayhead(t0, 1, steady(1e6), [{ tNewer: 0, tOlder: EARTH_FORMATION }])).toBe(advanceSteadyPlayhead(t0, 1, steady(1e6)))
      expect(advanceSteadyPlayhead(30e6, 2, steady(1e5), [])).toBe(advanceSteadyPlayhead(30e6, 2, steady(1e5)))
    })

    it('gives the same years for one huge step as for many small ones', () => {
      const territories = [0, 50, 100, 150].map((tNewer, i, a) => ({ tNewer, tOlder: a[i + 1] ?? EARTH_FORMATION }))
      const huge = advanceSteadyPlayhead(200, 0.8, steady(1e4), territories)
      let many = 200
      for (let i = 0; i < 5000; i++) many = advanceSteadyPlayhead(many, 0.8 / 5000, steady(1e4), territories)
      expect(Math.abs(huge - many)).toBeLessThan(1e-6)
    })
  })
})
