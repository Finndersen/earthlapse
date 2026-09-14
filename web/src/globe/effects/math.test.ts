import { describe, expect, it } from 'vitest'

import { clamp01, smoothstep } from './math'

describe('clamp01', () => {
  it('clamps to the unit interval', () => {
    expect(clamp01(-1)).toBe(0)
    expect(clamp01(0.5)).toBe(0.5)
    expect(clamp01(2)).toBe(1)
  })
})

describe('smoothstep', () => {
  it('is 0 at and below edge0, 1 at and above edge1', () => {
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
