import { describe, expect, it } from 'vitest'

import { glslFloat } from './glsl'

import { CLEARED_LAND_RAMP, CLEARED_LAND_RAMP_GLSL, CLEARED_LAND_WEIGHTS, clearedLandRampAt } from './clearedLand'

// --------------------------------------------------------------------------------- clearedLandRampAt

describe('clearedLandRampAt', () => {
  it('is flat at the floor for any severity at or below the first stop', () => {
    const first = CLEARED_LAND_RAMP[0]!
    const floor = [...first.color, first.alpha]
    expect(clearedLandRampAt(first.severity)).toEqual(floor)
    expect(clearedLandRampAt(0)).toEqual(floor)
    expect(clearedLandRampAt(-1)).toEqual(floor)
  })

  it('is flat at the ceiling for any severity at or above the last stop', () => {
    const last = CLEARED_LAND_RAMP[CLEARED_LAND_RAMP.length - 1]!
    const [r, g, b, a] = clearedLandRampAt(10)
    expect(r).toBeCloseTo(last.color[0], 6)
    expect(g).toBeCloseTo(last.color[1], 6)
    expect(b).toBeCloseTo(last.color[2], 6)
    expect(a).toBeCloseTo(last.alpha, 6)
  })

  it('hits every stop’s own colour and alpha exactly at its own severity', () => {
    for (const stop of CLEARED_LAND_RAMP) {
      const [r, g, b, a] = clearedLandRampAt(stop.severity)
      expect(r).toBeCloseTo(stop.color[0], 6)
      expect(g).toBeCloseTo(stop.color[1], 6)
      expect(b).toBeCloseTo(stop.color[2], 6)
      expect(a).toBeCloseTo(stop.alpha, 6)
    }
  })

  it('alpha is monotonically non-decreasing across the whole ramp', () => {
    let previous = -Infinity
    for (let s = 0; s <= 1; s += 0.01) {
      const alpha = clearedLandRampAt(s)[3]
      expect(alpha).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = alpha
    }
  })
})

describe('CLEARED_LAND_RAMP_GLSL', () => {
  it('declares vec4 clearedLandRampAt(float', () => {
    expect(CLEARED_LAND_RAMP_GLSL).toContain('vec4 clearedLandRampAt(float')
  })

  it('contains exactly one mix( per ramp interval, generated from the same stop list', () => {
    const mixCount = (CLEARED_LAND_RAMP_GLSL.match(/mix\(/g) ?? []).length
    expect(mixCount).toBe(CLEARED_LAND_RAMP.length - 1)
  })

  it('interpolates every stop’s own alpha literal, formatted via glslFloat', () => {
    for (const stop of CLEARED_LAND_RAMP) {
      expect(CLEARED_LAND_RAMP_GLSL).toContain(glslFloat(stop.alpha))
    }
  })
})

// ------------------------------------------------------------------------------ CLEARED_LAND_WEIGHTS

describe('CLEARED_LAND_WEIGHTS', () => {
  it('excludes natural rangeland from the severity collapse', () => {
    expect(CLEARED_LAND_WEIGHTS[2]).toBe(0)
  })

  it('weights cropland as full severity', () => {
    expect(CLEARED_LAND_WEIGHTS[0]).toBe(1)
  })
})
