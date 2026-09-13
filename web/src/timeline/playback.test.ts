import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type Playback, type TimeScale } from '@/types/layer'

import { advancePlayhead, type PlaybackPacingSegment } from './playback'
import { createSymlogScale } from './scale'

const fullScale: TimeScale = createSymlogScale([0, EARTH_FORMATION])

function playback(overrides: Partial<Playback> = {}): Playback {
  return { playing: true, baseRate: 0.1, speed: 1, ...overrides }
}

describe('advancePlayhead', () => {
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
})

// -------------------------------------------------------------------------------- pacing

describe('advancePlayhead: pacing (ADR-012)', () => {
  it('no pacing arg is identical to current behaviour', () => {
    const t = 1e8
    const withoutArg = advancePlayhead(t, 3, playback(), fullScale)
    const withEmptyArray = advancePlayhead(t, 3, playback(), fullScale, [])
    expect(withEmptyArray).toBe(withoutArg)
  })

  it('a dense gap (tiny u-span) at 1x takes at least its minSeconds of summed wall time to cross', () => {
    // ~5000 years wide, deep in the domain where the symlog derivative is tiny — a few
    // millionths of u, far less than minSeconds worth of the ordinary baseRate.
    const tNewer = 5e7
    const tOlder = 5.0005e7
    const minSeconds = 5
    const segment: PlaybackPacingSegment = { tNewer, tOlder, minSeconds }
    const pb = playback({ baseRate: 0.05, speed: 1 })

    let t = tOlder
    let elapsed = 0
    const dt = minSeconds / 200
    while (t > tNewer && elapsed < minSeconds * 4) {
      t = advancePlayhead(t, dt, pb, fullScale, [segment])
      elapsed += dt
    }

    expect(t).toBeLessThanOrEqual(tNewer)
    expect(elapsed).toBeGreaterThanOrEqual(minSeconds)
  })

  it('a sparse gap (wide u-span, tiny minSeconds) is not slowed below the ordinary baseRate', () => {
    const segment: PlaybackPacingSegment = { tNewer: 1e6, tOlder: 1e9, minSeconds: 0.001 }
    const pb = playback({ baseRate: 0.02, speed: 1 })
    const t0 = 5e8 // well inside the segment, away from either edge

    const u0 = fullScale.toUnit(t0)
    const withPacing = fullScale.toUnit(advancePlayhead(t0, 1, pb, fullScale, [segment])) - u0
    const withoutPacing = fullScale.toUnit(advancePlayhead(t0, 1, pb, fullScale)) - u0

    expect(withPacing).toBeCloseTo(withoutPacing, 9)
  })

  it('speed 8x divides a paced (floor-bound) duration by 8', () => {
    const tNewer = 5e7
    const tOlder = 5.0005e7
    const minSeconds = 5
    const segment: PlaybackPacingSegment = { tNewer, tOlder, minSeconds }

    function timeToCross(speed: number): number {
      const pb = playback({ baseRate: 0.05, speed })
      let t = tOlder
      let elapsed = 0
      const dt = minSeconds / (200 * speed)
      while (t > tNewer && elapsed < minSeconds * 4) {
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
    // Three contiguous dense segments, each capped well below baseRate.
    const segments: PlaybackPacingSegment[] = [
      { tNewer: 3e8, tOlder: 3.5e8, minSeconds: 2 },
      { tNewer: 2.5e8, tOlder: 3e8, minSeconds: 3 },
      { tNewer: 2e8, tOlder: 2.5e8, minSeconds: 1.5 },
    ]
    const pb = playback({ baseRate: 0.05, speed: 1 })
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

  it('caps velocity downward only — a paced segment never moves faster than baseRate would', () => {
    const segment: PlaybackPacingSegment = { tNewer: 5e7, tOlder: 5.0005e7, minSeconds: 5 }
    const pb = playback({ baseRate: 0.05, speed: 1 })
    const t0 = segment.tOlder

    const u0 = fullScale.toUnit(t0)
    const pacedDu = fullScale.toUnit(advancePlayhead(t0, 0.01, pb, fullScale, [segment])) - u0
    const uncappedDu = pb.baseRate * pb.speed * 0.01

    expect(pacedDu).toBeLessThanOrEqual(uncappedDu + 1e-12)
  })
})
