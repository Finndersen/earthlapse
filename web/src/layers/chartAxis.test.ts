import { describe, expect, it } from 'vitest'

import { axisTransform, LOG_AXIS_MIN_RATIO } from './chartAxis'

describe('axisTransform', () => {
  it('chooses linear (identity) below the ratio threshold', () => {
    const { toAxis, isLog } = axisTransform([100, 500])
    expect(isLog).toBe(false)
    expect(toAxis(500)).toBe(500)
  })

  it('chooses log once the max/min ratio reaches LOG_AXIS_MIN_RATIO', () => {
    const { toAxis, isLog } = axisTransform([10, 10 * LOG_AXIS_MIN_RATIO])
    expect(isLog).toBe(true)
    expect(toAxis(100)).toBeCloseTo(Math.log(100))
  })

  it('spreads a ~1,600x range across the axis', () => {
    const { toAxis, isLog } = axisTransform([4_432_265, 7_256_964_920])
    expect(isLog).toBe(true)
    const min = toAxis(4_432_265)
    const max = toAxis(7_256_964_920)
    const mid = toAxis(232_124_272) // 2025 yr BP, ~232 million
    expect((mid - min) / (max - min)).toBeGreaterThan(0.5)
  })

  it('falls back to linear when a value is zero or negative — a log axis can’t plot it', () => {
    const { isLog } = axisTransform([-5, 100])
    expect(isLog).toBe(false)
  })

  it('is well-defined for an empty series', () => {
    const { toAxis, isLog } = axisTransform([])
    expect(isLog).toBe(false)
    expect(toAxis(42)).toBe(42)
  })

})
