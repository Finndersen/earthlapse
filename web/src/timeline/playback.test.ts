import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type Playback, type TimeScale } from '@/types/layer'

import { advancePlayhead, advanceSteadyPlayhead, flooredSteadyRate, type PlaybackPacingSegment, type SteadySceneTerritory } from './playback'
import { createLinearScale, createSymlogScale } from './scale'
import { sectionById } from './sections'

const fullScale: TimeScale = createSymlogScale([0, EARTH_FORMATION])

function playback(overrides: Partial<Playback> = {}): Playback {
  return { playing: true, baseRate: 0.1, speed: 1, yearsPerSecond: 1, mode: 'scenes', ...overrides }
}

describe('advancePlayhead: base mechanics', () => {
  it('does not move t when not playing', () => {
    const t = 1e8
    expect(advancePlayhead(t, 1, playback({ playing: false }), fullScale)).toBe(t)
  })

  it('moves toward the present (t decreases)', () => {
    const t = 1e8
    const next = advancePlayhead(t, 1, playback(), fullScale)
    expect(next).toBeLessThan(t)
  })

  it('has constant du/dt outside every segment: doubling dt doubles the warped-space displacement', () => {
    const t = 1e8
    const u0 = fullScale.toUnit(t)
    const du1 = fullScale.toUnit(advancePlayhead(t, 1, playback(), fullScale)) - u0
    const du2 = fullScale.toUnit(advancePlayhead(t, 2, playback(), fullScale)) - u0
    expect(du2).toBeCloseTo(du1 * 2, 9)
  })

  it('scales with speed: doubling speed doubles the warped-space displacement', () => {
    const t = 1e8
    const u0 = fullScale.toUnit(t)
    const du1 = fullScale.toUnit(advancePlayhead(t, 1, playback({ speed: 1 }), fullScale)) - u0
    const du2 = fullScale.toUnit(advancePlayhead(t, 1, playback({ speed: 2 }), fullScale)) - u0
    expect(du2).toBeCloseTo(du1 * 2, 9)
  })

  it('clamps at the present and never overshoots past t = 0', () => {
    expect(advancePlayhead(10, 1e9, playback({ speed: 64 }), fullScale)).toBe(0)
    expect(advancePlayhead(10, 1e9, playback({ mode: 'steady', yearsPerSecond: 1e9 }), fullScale)).toBe(0)
  })

  it('stays finite and clamped at extreme speed and dt (no NaN, no overshoot)', () => {
    for (const pb of [playback({ speed: 64 }), playback({ mode: 'steady', yearsPerSecond: 1e9 })]) {
      const next = advancePlayhead(1e8, Number.MAX_VALUE, pb, fullScale)
      expect(Number.isFinite(next)).toBe(true)
      expect(next).toBeGreaterThanOrEqual(0)
      expect(next).toBeLessThanOrEqual(EARTH_FORMATION)
    }
  })

  it('is a no-op (not a crash) for a non-finite dt', () => {
    const t = 1e8
    expect(advancePlayhead(t, Number.NaN, playback(), fullScale)).toBe(t)
    expect(advancePlayhead(t, Infinity, playback(), fullScale)).toBe(t)
    expect(advancePlayhead(t, -Infinity, playback(), fullScale)).toBe(t)
  })

  it('never moves past t = 0 even already at the present', () => {
    expect(advancePlayhead(0, 1, playback(), fullScale)).toBe(0)
  })

  it('"scenes" mode with no scenesPacing moves at the flat baseRate * speed', () => {
    const t = 1e8
    const pb = playback({ baseRate: 0.03, speed: 2 })
    const expected = fullScale.fromUnit(fullScale.toUnit(t) + 0.03 * 2 * 3)
    expect(advancePlayhead(t, 3, pb, fullScale)).toBeCloseTo(expected, 0)
    expect(advancePlayhead(t, 3, pb, fullScale, [])).toBe(advancePlayhead(t, 3, pb, fullScale))
  })
})

describe('advancePlayhead: "steady" mode', () => {
  it('moves at yearsPerSecond in years, whatever scale is passed', () => {
    const pb = playback({ mode: 'steady', yearsPerSecond: 500 })
    expect(advancePlayhead(1e6, 2, pb, fullScale)).toBe(1e6 - 1000)
    expect(advancePlayhead(1e6, 2, pb, createLinearScale([0, EARTH_FORMATION]))).toBe(1e6 - 1000)
  })

  it('ignores scenesPacing entirely', () => {
    const segment: PlaybackPacingSegment = { tNewer: 5e7, tOlder: 5.0005e7, durationSeconds: 5 }
    const pb = playback({ mode: 'steady', yearsPerSecond: 1000 })
    expect(advancePlayhead(5.0005e7, 1, pb, fullScale, [segment])).toBe(advancePlayhead(5.0005e7, 1, pb, fullScale))
  })
})

// -------------------------------------------------------------------------- scenes mode

describe('advancePlayhead: "scenes" mode pacing (ADR-016)', () => {
  it('a single step of exactly durationSeconds crosses a dense segment exactly, at 1x', () => {
    // ~5000 years wide, deep in the domain where the symlog derivative is tiny — a few
    // millionths of u, far less than durationSeconds worth of the ordinary baseRate.
    const tNewer = 5e7
    const tOlder = 5.0005e7
    const durationSeconds = 5
    const segment: PlaybackPacingSegment = { tNewer, tOlder, durationSeconds }
    const pb = playback({ mode: 'scenes', baseRate: 0.05, speed: 1 })

    const next = advancePlayhead(tOlder, durationSeconds, pb, fullScale, [segment])
    expect(fullScale.toUnit(next)).toBeCloseTo(fullScale.toUnit(tNewer), 9)
  })

  it('crossing a dense segment via many small steps sums to exactly durationSeconds, no more and no less', () => {
    const tNewer = 5e7
    const tOlder = 5.0005e7
    const durationSeconds = 5
    const segment: PlaybackPacingSegment = { tNewer, tOlder, durationSeconds }
    const pb = playback({ mode: 'scenes', baseRate: 0.05, speed: 1 })

    let t = tOlder
    let elapsed = 0
    const dt = durationSeconds / 500
    while (t > tNewer && elapsed < durationSeconds * 4) {
      t = advancePlayhead(t, dt, pb, fullScale, [segment])
      elapsed += dt
    }
    expect(elapsed).toBeCloseTo(durationSeconds, 1)
  })

  it('a sparse gap (wide u-span, tiny duration) moves far faster than baseRate — no cap', () => {
    const segment: PlaybackPacingSegment = { tNewer: 1e6, tOlder: 1e9, durationSeconds: 0.001 }
    const pb = playback({ mode: 'scenes', baseRate: 0.02, speed: 1 })
    const t0 = 5e8 // well inside the segment, away from either edge

    const uSpan = fullScale.toUnit(segment.tNewer) - fullScale.toUnit(segment.tOlder)
    const expectedRate = uSpan / segment.durationSeconds

    const u0 = fullScale.toUnit(t0)
    const dt = 1e-6
    const du = fullScale.toUnit(advancePlayhead(t0, dt, pb, fullScale, [segment])) - u0

    expect(du / dt).toBeCloseTo(expectedRate, 3)
    expect(expectedRate).toBeGreaterThan(pb.baseRate * 10) // would have been capped under ADR-012's hybrid
  })

  it('t outside every segment moves at the ordinary baseRate * speed', () => {
    const segments: PlaybackPacingSegment[] = [{ tNewer: 5e8, tOlder: 6e8, durationSeconds: 0.001 }]
    const pb = playback({ mode: 'scenes', baseRate: 0.03, speed: 2 })
    const t0 = 1e9 // older than every segment
    const dt = 1e-6

    const u0 = fullScale.toUnit(t0)
    const du = fullScale.toUnit(advancePlayhead(t0, dt, pb, fullScale, segments)) - u0
    expect(du).toBeCloseTo(pb.baseRate * pb.speed * dt, 9)
  })

  it('speed 8x divides a paced segment-crossing duration by 8', () => {
    const tNewer = 5e7
    const tOlder = 5.0005e7
    const durationSeconds = 5
    const segment: PlaybackPacingSegment = { tNewer, tOlder, durationSeconds }

    function timeToCross(speed: number): number {
      const pb = playback({ mode: 'scenes', baseRate: 0.05, speed })
      let t = tOlder
      let elapsed = 0
      const dt = durationSeconds / (500 * speed)
      while (t > tNewer && elapsed < (durationSeconds / speed) * 4) {
        t = advancePlayhead(t, dt, pb, fullScale, [segment])
        elapsed += dt
      }
      return elapsed
    }

    const at1x = timeToCross(1)
    const at8x = timeToCross(8)
    expect(at8x).toBeCloseTo(at1x / 8, 2)
  })

  it('a single huge dt crosses several segments correctly and matches many small dts', () => {
    // Three contiguous dense segments, each with a duration well under baseRate's own crossing time.
    const segments: PlaybackPacingSegment[] = [
      { tNewer: 3e8, tOlder: 3.5e8, durationSeconds: 2 },
      { tNewer: 2.5e8, tOlder: 3e8, durationSeconds: 3 },
      { tNewer: 2e8, tOlder: 2.5e8, durationSeconds: 1.5 },
    ]
    const pb = playback({ mode: 'scenes', baseRate: 0.05, speed: 1 })
    const t0 = 4e8
    const totalDt = 20 // enough to fully cross every segment plus the unpaced stretches either side

    const viaOneHugeStep = advancePlayhead(t0, totalDt, pb, fullScale, segments)

    let viaManySmallSteps = t0
    const steps = 4000
    for (let i = 0; i < steps; i++) {
      viaManySmallSteps = advancePlayhead(viaManySmallSteps, totalDt / steps, pb, fullScale, segments)
    }

    const uHuge = fullScale.toUnit(viaOneHugeStep)
    const uMany = fullScale.toUnit(viaManySmallSteps)
    expect(uHuge).toBeCloseTo(uMany, 4)
  })

  it('a zero-width segment (degenerate tNewer === tOlder) does not stall integration', () => {
    const segments: PlaybackPacingSegment[] = [
      { tNewer: 5e7, tOlder: 5e7, durationSeconds: 5 },
      { tNewer: 4e7, tOlder: 4.5e7, durationSeconds: 1 },
    ]
    const pb = playback({ mode: 'scenes', baseRate: 0.05, speed: 1 })
    const next = advancePlayhead(6e7, 3, pb, fullScale, segments)
    expect(Number.isFinite(next)).toBe(true)
    expect(next).toBeLessThan(6e7)
  })
})

describe('advanceSteadyPlayhead: literal years per second', () => {
  const steady = (yearsPerSecond: number, overrides: Partial<Playback> = {}): Playback =>
    playback({ mode: 'steady', yearsPerSecond, ...overrides })

  it('advances t by about one year per second at the 1 yr/s detent near t = 100', () => {
    let t = 100
    for (let i = 0; i < 60; i++) t = advanceSteadyPlayhead(t, 1 / 60, steady(1))
    expect(100 - t).toBeCloseTo(1, 9)
  })

  it('advances by rate × dt anywhere on the timeline, independent of section', () => {
    const cases: [number, number][] = [
      [150, 10],
      [30e6, 5e5],
      [2e9, 5e7],
    ]
    for (const [t, rate] of cases) {
      expect(advanceSteadyPlayhead(t, 0.5, steady(rate))).toBeCloseTo(t - rate * 0.5, 6)
    }
  })

  it('carries on through section edges with no change of rate', () => {
    const industrial = sectionById('industrial-age').window
    const next = advanceSteadyPlayhead(industrial[0] + 5, 2, steady(5))
    expect(next).toBeCloseTo(industrial[0] - 5, 9)
  })

  it('stops at the present', () => {
    expect(advanceSteadyPlayhead(1, 1000, steady(10))).toBe(0)
  })

  it('is a no-op when paused, for a non-positive dt, or for a non-positive rate', () => {
    expect(advanceSteadyPlayhead(150, 1, steady(10, { playing: false }))).toBe(150)
    expect(advanceSteadyPlayhead(150, 0, steady(10))).toBe(150)
    expect(advanceSteadyPlayhead(150, 1, steady(0))).toBe(150)
    expect(advanceSteadyPlayhead(150, 1, steady(Number.NaN))).toBe(150)
  })

  it('rejects scenes mode', () => {
    expect(() => advanceSteadyPlayhead(150, 1, playback({ mode: 'scenes' }))).toThrow(/steady/)
  })
})

describe('flooredSteadyRate', () => {
  it('returns the requested rate when the scene dwells at least MIN_CUT_DWELL_SECONDS', () => {
    expect(flooredSteadyRate(100, 10)).toBe(10)
    expect(flooredSteadyRate(35, 100)).toBe(100)
  })

  it('slows to exactly MIN_CUT_DWELL_SECONDS of dwell when the scene would flash past', () => {
    expect(flooredSteadyRate(35, 1000)).toBeCloseTo(100, 9)
  })

  it('never speeds playback up', () => {
    for (const span of [0.1, 1, 10, 1e3, 1e9]) {
      for (const rate of [1, 10, 1e4, 1e9]) expect(flooredSteadyRate(span, rate)).toBeLessThanOrEqual(rate)
    }
  })

  it('leaves a zero-width territory at the requested rate', () => {
    expect(flooredSteadyRate(0, 50)).toBe(50)
  })
})

describe('advanceSteadyPlayhead: scene territory floor (ADR-029)', () => {
  const steady = (yearsPerSecond: number): Playback => playback({ mode: 'steady', yearsPerSecond })

  /** Wall-clock seconds a small-step simulation spends crossing `territory` from its older edge to
   *  its newer one. */
  function dwellCrossing(territory: SteadySceneTerritory, territories: readonly SteadySceneTerritory[], yearsPerSecond: number): number {
    const pb = steady(yearsPerSecond)
    let t = territory.tOlder
    let elapsed = 0
    const dt = 0.001
    for (let i = 0; i < 5_000_000 && t > territory.tNewer; i++) {
      t = advanceSteadyPlayhead(t, dt, pb, territories)
      elapsed += dt
    }
    return elapsed
  }

  it('gives a narrow territory at least MIN_CUT_DWELL_SECONDS at any rate', () => {
    const territories: SteadySceneTerritory[] = [
      { tNewer: 0, tOlder: 100 },
      { tNewer: 100, tOlder: 200 },
      { tNewer: 200, tOlder: EARTH_FORMATION },
    ]
    for (const rate of [500, 1e4, 1e9]) {
      expect(dwellCrossing(territories[1]!, territories, rate)).toBeGreaterThanOrEqual(0.35 - 0.01)
    }
  })

  it('bills every territory in a dense run its own dwell, skipping none', () => {
    const territories: SteadySceneTerritory[] = []
    for (let i = 0; i < 20; i++) territories.push({ tNewer: i * 2, tOlder: (i + 1) * 2 })
    territories.push({ tNewer: 40, tOlder: EARTH_FORMATION })

    const pb = steady(1e6)
    let t = 40
    let elapsed = 0
    const dt = 0.001
    for (let i = 0; i < 200_000 && t > 0; i++) {
      t = advanceSteadyPlayhead(t, dt, pb, territories)
      elapsed += dt
    }
    expect(elapsed).toBeGreaterThanOrEqual(20 * (0.35 - 0.01))
  })

  it('prorates a territory entered part-way, then floors the next one fully', () => {
    const territories: SteadySceneTerritory[] = [
      { tNewer: 0, tOlder: 50 },
      { tNewer: 50, tOlder: 100 },
      { tNewer: 100, tOlder: EARTH_FORMATION },
    ]
    const pb = steady(1e4)

    let t = 55
    let elapsedInEntered = 0
    for (let i = 0; i < 2000 && t > territories[1]!.tNewer; i++) {
      t = advanceSteadyPlayhead(t, 0.001, pb, territories)
      elapsedInEntered += 0.001
    }
    expect(Math.abs(t - territories[1]!.tNewer)).toBeLessThan(0.01)
    expect(elapsedInEntered).toBeGreaterThan(0)
    expect(elapsedInEntered).toBeLessThan(0.35)

    let elapsedInNext = 0
    for (let i = 0; i < 2000 && t > territories[0]!.tNewer; i++) {
      t = advanceSteadyPlayhead(t, 0.001, pb, territories)
      elapsedInNext += 0.001
    }
    expect(elapsedInNext).toBeGreaterThanOrEqual(0.35 - 0.01)
  })

  it('leaves a territory that already dwells long enough at the requested rate', () => {
    const territories: SteadySceneTerritory[] = [{ tNewer: 0, tOlder: EARTH_FORMATION }]
    const t0 = EARTH_FORMATION / 2
    expect(advanceSteadyPlayhead(t0, 1, steady(1e6), territories)).toBe(advanceSteadyPlayhead(t0, 1, steady(1e6)))
  })

  it('treats empty and omitted sceneTerritories identically', () => {
    expect(advanceSteadyPlayhead(30e6, 2, steady(1e5), [])).toBe(advanceSteadyPlayhead(30e6, 2, steady(1e5)))
  })

  it('never moves t away from the present when t sits newer than every territory', () => {
    const territories: SteadySceneTerritory[] = [{ tNewer: 100, tOlder: 200 }]
    const next = advanceSteadyPlayhead(50, 1, steady(10), territories)
    expect(next).toBe(40)
  })

  it('is a pure function: identical inputs produce identical output', () => {
    const territories: SteadySceneTerritory[] = [{ tNewer: 100, tOlder: 300 }]
    const a = advanceSteadyPlayhead(250, 0.05, steady(1e4), territories)
    const b = advanceSteadyPlayhead(250, 0.05, steady(1e4), territories)
    expect(a).toBe(b)
  })

  it('a huge single dt crossing several dense territories matches many small steps', () => {
    const territories: SteadySceneTerritory[] = [
      { tNewer: 0, tOlder: 50 },
      { tNewer: 50, tOlder: 100 },
      { tNewer: 100, tOlder: 150 },
      { tNewer: 150, tOlder: EARTH_FORMATION },
    ]
    const pb = steady(1e4)

    const viaOneHugeStep = advanceSteadyPlayhead(200, 0.8, pb, territories)
    let viaManySmallSteps = 200
    for (let i = 0; i < 5000; i++) viaManySmallSteps = advanceSteadyPlayhead(viaManySmallSteps, 0.8 / 5000, pb, territories)

    expect(viaOneHugeStep).toBeGreaterThan(0)
    expect(Math.abs(viaOneHugeStep - viaManySmallSteps)).toBeLessThan(1e-6)
  })
})
