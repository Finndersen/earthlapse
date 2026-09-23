import { describe, expect, it } from 'vitest'

import { clamp01, smoothstep, symlogWarp, SYMLOG_C, warpedEdgeProgress } from './math'

describe('clamp01 / smoothstep', () => {
  it('is 0 at and below edge0, 1 at and above edge1', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(2)).toBe(1)
    expect(smoothstep(0, 10, -5)).toBe(0)
    expect(smoothstep(0, 10, 0)).toBe(0)
    expect(smoothstep(0, 10, 10)).toBe(1)
    expect(smoothstep(0, 10, 15)).toBe(1)
  })

  it('is 0.5 at the midpoint and monotonic between the edges', () => {
    expect(smoothstep(0, 10, 5)).toBeCloseTo(0.5)
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => smoothstep(0, 10, x))
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!)
    }
  })
})

describe('symlogWarp', () => {
  it('is 0 at the present, ln 2 at the break-point, and increasing', () => {
    expect(symlogWarp(0)).toBe(0)
    expect(symlogWarp(SYMLOG_C)).toBeCloseTo(Math.LN2)
    expect(symlogWarp(1e9)).toBeGreaterThan(symlogWarp(1e6))
  })
})

describe('warpedEdgeProgress', () => {
  const unwarp = (w: number): number => SYMLOG_C * Math.expm1(w)
  const EASE = 0.015

  it('is 0 at the edge and 1 once the warped distance reaches the ease width, on either side', () => {
    expect(warpedEdgeProgress(6.61e8, 6.61e8, EASE)).toBe(0)
    expect(warpedEdgeProgress(unwarp(symlogWarp(6.61e8) + EASE), 6.61e8, EASE)).toBe(1)
    expect(warpedEdgeProgress(unwarp(symlogWarp(6.61e8) - EASE), 6.61e8, EASE)).toBe(1)
  })

  it('reads the same at the same warped offset in any era, unlike a fixed year width', () => {
    const halfWay = (edge: number): number => warpedEdgeProgress(unwarp(symlogWarp(edge) + EASE / 2), edge, EASE)
    expect(halfWay(2.0e4)).toBeCloseTo(0.5, 6)
    expect(halfWay(6.61e8)).toBeCloseTo(0.5, 6)
    expect(halfWay(2.4e9)).toBeCloseTo(0.5, 6)
  })
})
