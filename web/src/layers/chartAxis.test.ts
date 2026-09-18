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

  it('stays linear just under the ratio threshold', () => {
    const { isLog } = axisTransform([10, 10 * LOG_AXIS_MIN_RATIO - 1])
    expect(isLog).toBe(false)
  })

  it('spreads population’s ~1,600x range so growth is visible across the whole domain, not just a spike at the end', () => {
    // sources/hyde/README.md "Global population total": ~4.4 million (10,000 BCE) to
    // ~7.3 billion (2015 CE).
    const { toAxis, isLog } = axisTransform([4_432_265, 7_256_964_920])
    expect(isLog).toBe(true)
    // On a linear axis the mid-Holocene value below would sit within a fraction of a percent
    // of the domain's minimum; log spaces it out substantially instead.
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

  it('is well-defined for a single-value series (ratio of 1, never log)', () => {
    const { isLog } = axisTransform([100])
    expect(isLog).toBe(false)
  })
})
