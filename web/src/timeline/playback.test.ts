import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type Playback, type TimeScale } from '@/types/layer'

import { advancePlayhead, type PlaybackPacingSegment } from './playback'
import { createLinearScale, createSymlogScale } from './scale'

const fullScale: TimeScale = createSymlogScale([0, EARTH_FORMATION])

function playback(overrides: Partial<Playback> = {}): Playback {
  return { playing: true, baseRate: 0.1, speed: 1, mode: 'steady', ...overrides }
}

describe('advancePlayhead: base mechanics (both modes)', () => {
  it('does not move t when not playing', () => {
    const t = 1e8
    expect(advancePlayhead(t, 1, playback({ playing: false }), fullScale)).toBe(t)
  })

  it('moves toward the present (t decreases)', () => {
    const t = 1e8
    const next = advancePlayhead(t, 1, playback(), fullScale)
    expect(next).toBeLessThan(t)
  })

  it('has constant du/dt: doubling dt doubles the warped-space displacement', () => {
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
    const next = advancePlayhead(10, 1e9, playback({ speed: 64 }), fullScale)
    expect(next).toBe(0)
  })

  it('stays finite and clamped at extreme speed and dt (no NaN, no overshoot)', () => {
    const next = advancePlayhead(1e8, Number.MAX_VALUE, playback({ speed: 64 }), fullScale)
    expect(Number.isFinite(next)).toBe(true)
    expect(next).toBeGreaterThanOrEqual(0)
    expect(next).toBeLessThanOrEqual(EARTH_FORMATION)
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

  it('"scenes" mode with no scenesPacing degrades to the same flat rate as "steady"', () => {
    const t = 1e8
    const steady = advancePlayhead(t, 3, playback({ mode: 'steady' }), fullScale)
    const scenesNoPacing = advancePlayhead(t, 3, playback({ mode: 'scenes' }), fullScale)
    const scenesEmptyPacing = advancePlayhead(t, 3, playback({ mode: 'scenes' }), fullScale, [])
    expect(scenesNoPacing).toBe(steady)
    expect(scenesEmptyPacing).toBe(steady)
  })
})

// -------------------------------------------------------------------------- steady mode

describe('advancePlayhead: "steady" mode (ADR-016)', () => {
  it('moves at constant velocity in whatever fullScale is passed — symlog', () => {
    const t = 1e8
    const pb = playback({ mode: 'steady', baseRate: 0.02, speed: 3 })
    const u0 = fullScale.toUnit(t)
    const du = fullScale.toUnit(advancePlayhead(t, 2, pb, fullScale)) - u0
    expect(du).toBeCloseTo(pb.baseRate * pb.speed * 2, 9)
  })

  it('moves at constant velocity in whatever fullScale is passed — linear (the currently selected scale kind)', () => {
    const linearScale = createLinearScale([0, EARTH_FORMATION])
    const t = 2e9
    const pb = playback({ mode: 'steady', baseRate: 0.02, speed: 1 })
    const u0 = linearScale.toUnit(t)
    const du = linearScale.toUnit(advancePlayhead(t, 5, pb, linearScale)) - u0
    expect(du).toBeCloseTo(pb.baseRate * pb.speed * 5, 9)
  })

  it('ignores scenesPacing entirely, even a dense one that would floor "scenes" mode', () => {
    const segment: PlaybackPacingSegment = { tNewer: 5e7, tOlder: 5.0005e7, durationSeconds: 5 }
    const pb = playback({ mode: 'steady', baseRate: 0.05, speed: 1 })
    const t = 5.0005e7
    const withPacing = advancePlayhead(t, 1, pb, fullScale, [segment])
    const withoutPacing = advancePlayhead(t, 1, pb, fullScale)
    expect(withPacing).toBe(withoutPacing)
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

  it('t outside every segment moves at the ordinary baseRate * speed, same as "steady"', () => {
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
