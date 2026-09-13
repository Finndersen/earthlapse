import { describe, expect, it } from 'vitest'

import { transitionUniforms } from './transition'

describe('transitionUniforms: purity', () => {
  it('is a pure function of mix alone', () => {
    expect(transitionUniforms(0.37)).toEqual(transitionUniforms(0.37))
  })
})

describe('transitionUniforms: endpoints are exact', () => {
  it('at mix 0, blur is exactly 0 and the feathered threshold band sits entirely above [0, 1]', () => {
    const u = transitionUniforms(0)
    expect(u.mix).toBe(0)
    expect(u.blur).toBe(0)
    expect(u.threshold - u.edge).toBeGreaterThanOrEqual(1)
  })

  it('at mix 1, blur is exactly 0 and the feathered threshold band sits entirely below [0, 1]', () => {
    const u = transitionUniforms(1)
    expect(u.mix).toBe(1)
    expect(u.blur).toBe(0)
    expect(u.threshold + u.edge).toBeLessThanOrEqual(0)
  })

  it('clamps mix outside [0, 1] to the same exact endpoint values', () => {
    expect(transitionUniforms(-0.3)).toEqual(transitionUniforms(0))
    expect(transitionUniforms(1.4)).toEqual(transitionUniforms(1))
  })
})

describe('transitionUniforms: blur-through peaks at mix 0.5', () => {
  it('is positive strictly between the endpoints', () => {
    expect(transitionUniforms(0.5).blur).toBeGreaterThan(0)
    expect(transitionUniforms(0.2).blur).toBeGreaterThan(0)
    expect(transitionUniforms(0.8).blur).toBeGreaterThan(0)
  })

  it('is maximal at mix 0.5', () => {
    const peak = transitionUniforms(0.5).blur
    for (const mix of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
      expect(transitionUniforms(mix).blur).toBeLessThan(peak)
    }
  })

  it('is symmetric around mix 0.5', () => {
    expect(transitionUniforms(0.3).blur).toBeCloseTo(transitionUniforms(0.7).blur)
    expect(transitionUniforms(0.1).blur).toBeCloseTo(transitionUniforms(0.9).blur)
  })
})

describe('transitionUniforms: threshold sweeps monotonically with mix', () => {
  it('decreases as mix increases, so higher-reveal-value pixels (brighter, per the shader) cross it sooner', () => {
    const mixes = [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1]
    const thresholds = mixes.map((m) => transitionUniforms(m).threshold)
    for (let i = 1; i < thresholds.length; i++) {
      expect(thresholds[i]!).toBeLessThan(thresholds[i - 1]!)
    }
  })

  it('is 0.5 at mix 0.5 — the feathered band is centred in the noise field\'s range', () => {
    expect(transitionUniforms(0.5).threshold).toBeCloseTo(0.5)
  })
})

describe('transitionUniforms: edge and luminanceBias are constant', () => {
  it('edge does not vary with mix', () => {
    expect(transitionUniforms(0).edge).toBe(transitionUniforms(0.5).edge)
    expect(transitionUniforms(0.5).edge).toBe(transitionUniforms(1).edge)
  })

  it('luminanceBias does not vary with mix', () => {
    expect(transitionUniforms(0).luminanceBias).toBe(transitionUniforms(0.5).luminanceBias)
    expect(transitionUniforms(0.5).luminanceBias).toBe(transitionUniforms(1).luminanceBias)
  })
})
