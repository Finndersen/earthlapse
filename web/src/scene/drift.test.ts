import { describe, expect, it } from 'vitest'

import type { Scene } from '@/types/manifest'

import { driftAt, REST_DRIFT } from './drift'

function scene(id: string, t: number): Scene {
  return {
    id,
    t,
    chapterId: 'ch',
    image: `${id}.png`,
    shot: 'WIDE_RIDGE',
    caption: `caption ${id}`,
    width: 1920,
    height: 1080,
  }
}

const s0 = scene('s0', 0)
const s1 = scene('s1', 100)
const s2 = scene('s2', 200)
const s3 = scene('s3', 400)
const scenes: Scene[] = [s0, s1, s2, s3]

function logMidpointT(a: number, b: number): number {
  return Math.expm1((Math.log1p(a) + Math.log1p(b)) / 2)
}

// --------------------------------------------------------------------------------- purity

describe('driftAt', () => {
  it('is a pure function of (scenes, index, t) — same inputs, same output', () => {
    const a = driftAt(scenes, 1, 150)
    const b = driftAt(scenes, 1, 150)
    expect(a).toEqual(b)
  })

  it('does not depend on wall-clock time or call order', () => {
    driftAt(scenes, 2, 250)
    driftAt(scenes, 0, 10)
    const a = driftAt(scenes, 1, 150)
    driftAt(scenes, 3, 350)
    const b = driftAt(scenes, 1, 150)
    expect(a).toEqual(b)
  })
})

// --------------------------------------------------------------------------- bounded zoom

describe('driftAt: zoom is bounded', () => {
  it('never drops below 1 (no zoom out past the original framing)', () => {
    for (const t of [0, 50, 100, 150, 200, 300, 400, 1000]) {
      for (let i = 0; i < scenes.length; i++) {
        expect(driftAt(scenes, i, t).zoom).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('never exceeds the 1.05 ceiling', () => {
    for (const t of [0, 50, 100, 150, 200, 300, 400, 1000]) {
      for (let i = 0; i < scenes.length; i++) {
        expect(driftAt(scenes, i, t).zoom).toBeLessThanOrEqual(1.05)
      }
    }
  })
})

// -------------------------------------------------------------------- never reveals edges

describe('driftAt: never reveals an image edge', () => {
  it('keeps the lateral pan within the crop margin the current zoom affords, at every t', () => {
    for (const t of [0, 25, 50, 75, 100, 150, 200, 250, 300, 350, 400, 500]) {
      for (let i = 0; i < scenes.length; i++) {
        const { zoom, dx, dy } = driftAt(scenes, i, t)
        const margin = (zoom - 1) / 2
        expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(margin + 1e-9)
      }
    }
  })

  it('is at rest (no pan) when zoom is exactly 1', () => {
    // scene 3 (oldest) hasn't started its push-in yet at its own span's far edge.
    const drift = driftAt(scenes, 3, scenes[3]!.t + 1)
    expect(drift.zoom).toBe(1)
    expect(drift.dx).toBe(0)
    expect(drift.dy).toBe(0)
  })
})

// ------------------------------------------------------------------------------ continuity

describe('driftAt: continuous within a scene\'s own hold span', () => {
  it('changes smoothly as t sweeps across the whole span, no jumps', () => {
    const [start, end] = [logMidpointT(s0.t, s1.t), logMidpointT(s1.t, s2.t)]
    const samples = Array.from({ length: 41 }, (_, i) => start + ((end - start) * i) / 40)
    const zooms = samples.map((t) => driftAt(scenes, 1, t).zoom)
    for (let i = 1; i < zooms.length; i++) {
      expect(Math.abs(zooms[i]! - zooms[i - 1]!)).toBeLessThan(0.01)
    }
  })

  it('is monotone with playback direction (t decreasing toward the present, DESIGN §3): zoom increases as t falls across the span', () => {
    const [start, end] = [logMidpointT(s0.t, s1.t), logMidpointT(s1.t, s2.t)]
    const samples = Array.from({ length: 21 }, (_, i) => end - ((end - start) * i) / 20)
    const zooms = samples.map((t) => driftAt(scenes, 1, t).zoom)
    for (let i = 1; i < zooms.length; i++) {
      expect(zooms[i]!).toBeGreaterThanOrEqual(zooms[i - 1]! - 1e-9)
    }
    expect(zooms[zooms.length - 1]!).toBeGreaterThan(zooms[0]!)
  })

  it('reaches its widest (zoom 1) right as the scene fades in, and its closest (zoom 1.05) right as the next dissolve completes', () => {
    const [start, end] = [logMidpointT(s0.t, s1.t), logMidpointT(s1.t, s2.t)]
    expect(driftAt(scenes, 1, end).zoom).toBeCloseTo(1)
    expect(driftAt(scenes, 1, start).zoom).toBeCloseTo(1.05)
  })
})

// -------------------------------------------------------------------------------- edge cases

describe('driftAt edge cases', () => {
  it('holds at rest for a single-scene list rather than dividing by zero', () => {
    expect(driftAt([s1], 0, s1.t)).toEqual(REST_DRIFT)
    expect(driftAt([s1], 0, -1e9)).toEqual(REST_DRIFT)
    expect(driftAt([s1], 0, 1e9)).toEqual(REST_DRIFT)
  })

  it('clamps rather than extrapolates for t far outside every scene\'s own span', () => {
    const drift = driftAt(scenes, 0, 1e9)
    expect(drift.zoom).toBeGreaterThanOrEqual(1)
    expect(drift.zoom).toBeLessThanOrEqual(1.05)
  })
})

// -------------------------------------------------------------------------------- REST_DRIFT

describe('REST_DRIFT', () => {
  it('is the identity — no zoom, no pan', () => {
    expect(REST_DRIFT).toEqual({ zoom: 1, dx: 0, dy: 0 })
  })
})
