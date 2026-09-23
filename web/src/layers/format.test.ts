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

  it('bumps a value that rounds up to a bare 1000 into the next tier', () => {
    expect(formatPopulation(999_950_000)).toBe('1.0 billion')
  })

  it('falls back to a plain comma-grouped integer below 1,000', () => {
    expect(formatPopulation(999)).toBe('999')
    expect(formatPopulation(0)).toBe('0')
  })

})

describe('formatScalarValue', () => {
  it('uses formatPopulation for a "people" unit', () => {
    expect(formatScalarValue(2_400_000, 'people')).toBe('2.4 million')
  })

})

describe('clampUnit', () => {
  it('clamps to [0, 1]', () => {
    expect(clampUnit(-0.5)).toBe(0)
    expect(clampUnit(1.5)).toBe(1)
    expect(clampUnit(0.3)).toBe(0.3)
  })
})
