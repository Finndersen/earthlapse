import { describe, expect, it } from 'vitest'

import { crossfadeAlpha } from './transition'

describe('crossfadeAlpha: endpoints are exact', () => {
  it('is exactly 0 at mix 0 and exactly 1 at mix 1', () => {
    expect(crossfadeAlpha(0)).toBe(0)
    expect(crossfadeAlpha(1)).toBe(1)
  })

  it('clamps mix outside [0, 1] to the same exact endpoint values', () => {
    expect(crossfadeAlpha(-0.3)).toBe(0)
    expect(crossfadeAlpha(1.4)).toBe(1)
  })
})

describe('crossfadeAlpha: eases between the endpoints', () => {
  it('is monotonically non-decreasing across [0, 1]', () => {
    const samples = Array.from({ length: 21 }, (_, i) => crossfadeAlpha(i / 20))
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!).toBeGreaterThanOrEqual(samples[i - 1]!)
    }
  })

  it('is exactly 0.5 at mix 0.5 (smoothstep is symmetric)', () => {
    expect(crossfadeAlpha(0.5)).toBe(0.5)
  })

  it('eases in and out — slower than linear near both endpoints', () => {
    // Smoothstep's derivative is 0 at the endpoints, so an equal step in `mix` near an
    // endpoint moves `crossfadeAlpha` less than the same step would in the middle.
    const nearStart = crossfadeAlpha(0.1) - crossfadeAlpha(0)
    const middle = crossfadeAlpha(0.55) - crossfadeAlpha(0.45)
    expect(nearStart).toBeLessThan(middle)
  })

  it('is a pure function of mix alone', () => {
    expect(crossfadeAlpha(0.37)).toBe(crossfadeAlpha(0.37))
  })
})
