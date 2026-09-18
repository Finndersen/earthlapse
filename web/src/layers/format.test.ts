import { describe, expect, it } from 'vitest'

import { clampUnit, formatPopulation, formatScalarValue, formatValue } from './format'

describe('formatValue', () => {
  it('rounds to a whole number once the magnitude is large (>= 100)', () => {
    expect(formatValue(1200)).toBe('1200')
  })

  it('keeps one decimal in the 1-100 range, trimming a bare trailing zero', () => {
    expect(formatValue(11.7)).toBe('11.7')
    expect(formatValue(10)).toBe('10')
  })

  it('never renders a genuinely nonzero value as a bare "0"', () => {
    expect(formatValue(0.001)).not.toBe('0')
  })
})

describe('formatPopulation', () => {
  it('formats million-scale values with one decimal', () => {
    expect(formatPopulation(2_400_000)).toBe('2.4 million')
  })

  it('formats billion-scale values with one decimal, keeping a round trailing zero', () => {
    expect(formatPopulation(1_000_000_000)).toBe('1.0 billion')
    expect(formatPopulation(7_300_000_000)).toBe('7.3 billion')
  })

  it('drops the decimal once the scaled value reaches double digits', () => {
    expect(formatPopulation(232_000_000)).toBe('232 million')
    expect(formatPopulation(428_000_000)).toBe('428 million')
  })

  it('matches the HYDE-derived sanity-check figures at real checkpoints', () => {
    // sources/hyde/README.md "Global population total" -- 10,000 BCE and 2015 CE.
    expect(formatPopulation(4_432_265)).toBe('4.4 million')
    expect(formatPopulation(7_256_964_920)).toBe('7.3 billion')
  })

  it('bumps a value that rounds up to a bare 1000 into the next tier', () => {
    // 999.95 million rounds to "1000 million" at the million tier -- report it as "1.0
    // billion" instead, never a scale word paired with a four-digit number.
    expect(formatPopulation(999_950_000)).toBe('1.0 billion')
  })

  it('falls back to a plain comma-grouped integer below 1,000', () => {
    expect(formatPopulation(999)).toBe('999')
    expect(formatPopulation(0)).toBe('0')
  })

  it('is unambiguous across four orders of magnitude, never the same string twice', () => {
    const values = [4_432_265, 232_124_272, 591_722_989, 1_642_028_156, 6_110_442_981, 7_256_964_920]
    const formatted = values.map(formatPopulation)
    expect(new Set(formatted).size).toBe(formatted.length)
  })
})

describe('formatScalarValue', () => {
  it('uses formatPopulation for a "people" unit', () => {
    expect(formatScalarValue(2_400_000, 'people')).toBe('2.4 million')
  })

  it('uses formatValue for every other unit, unchanged', () => {
    expect(formatScalarValue(1200, 'ppm')).toBe('1200')
  })
})

describe('clampUnit', () => {
  it('treats NaN as 0 rather than letting it pass through unclamped', () => {
    expect(clampUnit(Number.NaN)).toBe(0)
  })

  it('clamps to [0, 1]', () => {
    expect(clampUnit(-0.5)).toBe(0)
    expect(clampUnit(1.5)).toBe(1)
    expect(clampUnit(0.3)).toBe(0.3)
  })
})
