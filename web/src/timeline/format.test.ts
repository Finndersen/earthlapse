import { describe, expect, it } from 'vitest'

import { formatCalendarYear, formatGeoTime, formatGeoTimePrecise, formatRate, formatTimeRange } from './format'

describe('formatGeoTime', () => {
  it('picks a unit bucket by magnitude, trimming a trailing .0', () => {
    const cases: [number, string][] = [
      [0, 'present'],
      [1, '1 year ago'],
      [250, '250 years ago'],
      [10_000, '10 ka'],
      [11_700, '11.7 ka'],
      [66_000_000, '66 Ma'],
      [4.567e9, '4.57 Ga'],
    ]
    for (const [t, expected] of cases) expect(formatGeoTime(t)).toBe(expected)
  })

  it('rejects negative or non-finite t', () => {
    expect(() => formatGeoTime(-1)).toThrow()
    expect(() => formatGeoTime(Number.NaN)).toThrow()
  })
})

describe('formatTimeRange', () => {
  it('shares a unit suffix within a bucket, collapsing edges that print alike', () => {
    expect(formatTimeRange([2.01e8, 2.52e8])).toBe('252–201 Ma')
    expect(formatTimeRange([6.6e7, 6.6e7])).toBe('66 Ma')
    expect(formatTimeRange([6.6e7, 6.6043e7])).toBe('66 Ma')
  })

  it('spells out both edges across buckets and below a millennium', () => {
    expect(formatTimeRange([0, 1.17e4])).toBe('11.7 ka – present')
    expect(formatTimeRange([250, 1.17e4])).toBe('11.7 ka – 250 years ago')
    expect(formatTimeRange([10, 250])).toBe('250 years ago – 10 years ago')
  })
})

describe('formatGeoTimePrecise', () => {
  it('falls back to formatGeoTime when the precision adds nothing or is invalid', () => {
    for (const precision of [1e7, 0, Number.NaN]) expect(formatGeoTimePrecise(66_000_000, precision)).toBe('66 Ma')
    expect(formatGeoTimePrecise(0, 1e-9)).toBe('present')
  })

  it('prints just enough decimals of raw years to resolve the precision, capped', () => {
    expect(formatGeoTimePrecise(123.456, 0.01)).toBe('123.46 years ago')
    expect(formatGeoTimePrecise(66_043_000, 1e-9)).toBe('66,043,000.000000 years ago')
    const trio = [66_043_000, 66_042_999.99, 66_042_900].map((t) => formatGeoTimePrecise(t, 0.001))
    expect(new Set(trio).size).toBe(3)
  })

  it('rejects negative t', () => {
    expect(() => formatGeoTimePrecise(-1, 1)).toThrow()
  })
})

describe('formatRate', () => {
  it('picks a unit bucket by magnitude, keeping two significant figures below 10 yr/s', () => {
    const cases: [number, string][] = [
      [0.004, '< 0.01 yr/s'],
      [0.13, '0.13 yr/s'],
      [0.998, '1 yr/s'],
      [42, '42 yr/s'],
      [2.1e5, '210 kyr/s'],
      [4e7, '40 Myr/s'],
      [3.2e9, '3.2 Gyr/s'],
    ]
    for (const [rate, expected] of cases) expect(formatRate(rate)).toBe(expected)
  })

  it('rejects negative or non-finite rates', () => {
    expect(() => formatRate(-1)).toThrow()
    expect(() => formatRate(Infinity)).toThrow()
  })
})

describe('formatCalendarYear', () => {
  it('renders calendar years without a year zero, and null above the horizon', () => {
    expect(formatCalendarYear(0)).toBe('2025 CE')
    expect(formatCalendarYear(2024)).toBe('1 CE')
    expect(formatCalendarYear(2025)).toBe('1 BCE')
    expect(formatCalendarYear(3001)).toBeNull()
    expect(() => formatCalendarYear(Number.NaN)).toThrow()
  })
})
