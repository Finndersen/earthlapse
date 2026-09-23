import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type Playback, type TimeScale } from '@/types/layer'

import {
  advancePlayhead,
  advanceSteadyPlayhead,
  SPEED_OPTIONS,
  stepSpeed,
  type PlaybackPacingSegment,
  type SteadySceneTerritory,
} from './playback'
import { createLinearScale, createSymlogScale } from './scale'
import { sectionById } from './sections'

const fullScale: TimeScale = createSymlogScale([0, EARTH_FORMATION])
const MIN_CUT_DWELL_SECONDS = 0.35

function playback(overrides: Partial<Playback> = {}): Playback {
  return { playing: true, baseRate: 0.1, speed: 1, mode: 'steady', ...overrides }
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

  it('ignores pacing in steady mode, and scenes mode without pacing matches steady', () => {
    const segment = { tNewer: 5e7, tOlder: 5.0005e7, durationSeconds: 5 }
    const steady = advancePlayhead(5.0005e7, 1, playback(), fullScale)
    expect(advancePlayhead(5.0005e7, 1, playback(), fullScale, [segment])).toBe(steady)
    expect(advancePlayhead(5.0005e7, 1, playback({ mode: 'scenes' }), fullScale, [])).toBe(steady)
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

describe('advanceSteadyPlayhead: sections', () => {
  const steady = (overrides: Partial<Playback> = {}) => playback({ baseRate: 0.1, ...overrides })

  it("moves at constant velocity in the section's own scale", () => {
    const cenozoic = createSymlogScale(sectionById('cenozoic').window)
    const next = advanceSteadyPlayhead(30e6, 2, steady({ baseRate: 0.02 }), 'cenozoic', createSymlogScale)
    expect(cenozoic.toUnit(next) - cenozoic.toUnit(30e6)).toBeCloseTo(0.04, 10)
  })

  it('carries the remainder of a frame across the section edge, including from exactly on it', () => {
    // Industrial age [111, 265] linear; the leftover time moves into Modern [0, 111].
    const secondsToEdge = (1 - (265 - 120) / 154) / 0.1
    expect(advanceSteadyPlayhead(120, 1, steady(), 'industrial-age', createLinearScale)).toBeCloseTo(111 - (1 - secondsToEdge) * 0.1 * 111, 8)
    expect(advanceSteadyPlayhead(111, 0.1, steady(), 'industrial-age', createLinearScale)).toBeLessThan(111)
  })

  it("continues to the parent's next sibling after the last child, stopping at the present", () => {
    const permian = sectionById('permian')
    const next = advanceSteadyPlayhead(permian.window[0] + 1, 3, steady(), 'permian', createLinearScale)
    expect(next).toBeLessThan(permian.window[0])
    expect(createLinearScale(sectionById('mesozoic').window).toUnit(next)).toBeGreaterThan(0.25)
    expect(advanceSteadyPlayhead(1, 1000, steady(), 'modern', createSymlogScale)).toBe(0)
  })

  it('is a no-op when paused or for zero dt, and rejects scenes mode or t outside the section', () => {
    expect(advanceSteadyPlayhead(150, 1, steady({ playing: false }), 'industrial-age', createLinearScale)).toBe(150)
    expect(advanceSteadyPlayhead(150, 0, steady(), 'industrial-age', createLinearScale)).toBe(150)
    expect(() => advanceSteadyPlayhead(150, 1, playback({ mode: 'scenes' }), 'industrial-age', createLinearScale)).toThrow(/steady/)
    expect(() => advanceSteadyPlayhead(50, 1, steady(), 'industrial-age', createLinearScale)).toThrow(/outside/)
  })
})

describe('advanceSteadyPlayhead: scene territory floor', () => {
  const steady = (speed: number) => playback({ baseRate: 0.02, speed })
  type SectionArg = Parameters<typeof advanceSteadyPlayhead>[3]
  type ScaleArg = Parameters<typeof advanceSteadyPlayhead>[4]

  function dwell(from: number, to: number, speed: number, section: SectionArg, scale: ScaleArg, territories: SteadySceneTerritory[]): number {
    let t = from
    let elapsed = 0
    for (let i = 0; i < 5_000_000 && t > to; i++) {
      t = advanceSteadyPlayhead(t, 0.001, steady(speed), section, scale, territories)
      elapsed += 0.001
    }
    return elapsed
  }

  it.each([
    ['earth', createSymlogScale, [0, 100, 200]],
    ['earth', createLinearScale, [0, 5, 10, 15]],
    ['industrial-age', createLinearScale, [111, 150, 155]],
  ] as const)('floors a narrow territory in %s to the minimum dwell at every speed', (section, scale, edges) => {
    const top = section === 'industrial-age' ? 265 : EARTH_FORMATION
    const bounds = [...edges, top]
    const territories = bounds.slice(0, -1).map((tNewer, i) => ({ tNewer, tOlder: bounds[i + 1]! }))
    for (const speed of [1, 8, 64]) {
      expect(dwell(territories[1]!.tOlder, territories[1]!.tNewer, speed, section, scale, territories)).toBeGreaterThanOrEqual(MIN_CUT_DWELL_SECONDS - 0.01)
    }
  })

  it('never skips a territory in a dense run', () => {
    const territories = Array.from({ length: 20 }, (_, i) => ({ tNewer: i * 2, tOlder: (i + 1) * 2 }))
    territories.push({ tNewer: 40, tOlder: EARTH_FORMATION })
    expect(dwell(40, 0, 8, 'earth', createLinearScale, territories)).toBeGreaterThanOrEqual(20 * (MIN_CUT_DWELL_SECONDS - 0.01))
  })

  it('prorates a territory entered mid-way, then floors the next one fully', () => {
    const territories = [
      { tNewer: 0, tOlder: 50 },
      { tNewer: 50, tOlder: 100 },
      { tNewer: 100, tOlder: EARTH_FORMATION },
    ]
    const entered = dwell(55, 50, 1, 'earth', createLinearScale, territories)
    expect(entered).toBeGreaterThan(0)
    expect(entered).toBeLessThan(MIN_CUT_DWELL_SECONDS)
    expect(dwell(50, 0, 1, 'earth', createLinearScale, territories)).toBeGreaterThanOrEqual(MIN_CUT_DWELL_SECONDS - 0.01)
  })

  it('leaves wide territories and an empty list at the flat rate', () => {
    const t0 = EARTH_FORMATION / 2
    const flat = advanceSteadyPlayhead(t0, 1, steady(1), 'earth', createSymlogScale)
    expect(fullScale.toUnit(advanceSteadyPlayhead(t0, 1, steady(1), 'earth', createSymlogScale, [{ tNewer: 0, tOlder: EARTH_FORMATION }]))).toBeCloseTo(
      fullScale.toUnit(flat),
      9,
    )
    expect(advanceSteadyPlayhead(30e6, 2, steady(3), 'cenozoic', createSymlogScale, [])).toBe(
      advanceSteadyPlayhead(30e6, 2, steady(3), 'cenozoic', createSymlogScale),
    )
  })

  it('gives the same years for one huge step as for many small ones', () => {
    const territories = [0, 50, 100, 150].map((tNewer, i, a) => ({ tNewer, tOlder: a[i + 1] ?? EARTH_FORMATION }))
    const huge = advanceSteadyPlayhead(200, 5, steady(64), 'earth', createSymlogScale, territories)
    let many = 200
    for (let i = 0; i < 5000; i++) many = advanceSteadyPlayhead(many, 5 / 5000, steady(64), 'earth', createSymlogScale, territories)
    expect(Math.abs(huge - many)).toBeLessThan(1e-6)
  })
})

describe('stepSpeed', () => {
  it('steps between options, clamping at both ends', () => {
    expect(stepSpeed(1, 'up')).toBe(2)
    expect(stepSpeed(64, 'down')).toBe(32)
    expect(stepSpeed(64, 'up')).toBe(64)
    expect(stepSpeed(0.25, 'down')).toBe(0.25)
  })

  it('resolves an off-list value to the nearest option on the requested side', () => {
    expect(stepSpeed(3, 'up')).toBe(4)
    expect(stepSpeed(3, 'down')).toBe(2)
    expect(stepSpeed(1000, 'up')).toBe(64)
    expect(stepSpeed(0.01, 'down')).toBe(0.25)
  })

  it('reaches every option stepping up from the slowest', () => {
    const seen: number[] = [SPEED_OPTIONS[0]]
    for (let i = 1; i < SPEED_OPTIONS.length; i++) seen.push(stepSpeed(seen.at(-1)!, 'up'))
    expect(seen).toEqual([...SPEED_OPTIONS])
  })
})
