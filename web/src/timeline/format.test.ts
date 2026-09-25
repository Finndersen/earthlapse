import { describe, expect, it } from 'vitest'

import { formatAge, formatCompanionReading, formatGeoTime, formatGeoTimePrecise, formatRate, formatTimeRange } from './format'

describe('formatGeoTime', () => {
  it('writes calendar years inside the Holocene and ages beyond it', () => {
    const cases: [number, string][] = [
      [0, 'present'],
      [1, '2024'],
      [533, '1492'],
      [1549, '476 CE'],
      [2024, '1 CE'],
      [2025, '1 BCE'],
      [5225, '3200 BCE'],
      [11_725, '9700 BCE'],
      [11_800, '11.8 ka'],
      [66_000_000, '66 Ma'],
      [4.567e9, '4.57 Ga'],
    ]
    for (const [t, expected] of cases) expect(formatGeoTime(t)).toBe(expected)
  })

  it('rounds prehistoric calendar years to the century', () => {
    expect(formatGeoTime(10_000)).toBe('8000 BCE')
    expect(formatGeoTime(5025)).toBe('3000 BCE')
  })

  it('rejects negative or non-finite t', () => {
    expect(() => formatGeoTime(-1)).toThrow()
    expect(() => formatGeoTime(Number.NaN)).toThrow()
  })
})

describe('formatAge', () => {
  it('picks a unit bucket by magnitude, trimming a trailing .0', () => {
    const cases: [number, string][] = [
      [0, 'present'],
      [1, '1 year ago'],
      [250, '250 years ago'],
      [10_000, '10 ka'],
      [11_700, '11.7 ka'],
    ]
    for (const [t, expected] of cases) expect(formatAge(t)).toBe(expected)
  })
})

describe('formatCompanionReading', () => {
  it('gives a date its elapsed time and the present its year, and an age nothing', () => {
    expect(formatCompanionReading(533)).toBe('533 years ago')
    expect(formatCompanionReading(11_725)).toBe('11,725 years ago')
    expect(formatCompanionReading(0)).toBe('2025')
    expect(formatCompanionReading(66_000_000)).toBeNull()
  })
})

describe('formatTimeRange', () => {
  it('shares a unit suffix within a bucket, collapsing edges that print alike', () => {
    expect(formatTimeRange([2.01e8, 2.52e8])).toBe('252–201 Ma')
    expect(formatTimeRange([6.6e7, 6.6e7])).toBe('66 Ma')
    expect(formatTimeRange([6.6e7, 6.6043e7])).toBe('66 Ma')
  })

  it('writes a window in its oldest edge\'s notation, never mixing the two', () => {
    expect(formatTimeRange([0, 1.17e4])).toBe('9700 BCE – present')
    expect(formatTimeRange([0, 1.2e4])).toBe('12 ka – present')
    expect(formatTimeRange([250, 2e4])).toBe('20 ka – 250 years ago')
  })

  it('shares an era suffix between calendar edges when both have the same one', () => {
    expect(formatTimeRange([111, 1111])).toBe('914–1914 CE')
    expect(formatTimeRange([80, 111])).toBe('1914–1945')
    expect(formatTimeRange([2525, 5225])).toBe('3200–500 BCE')
    expect(formatTimeRange([1549, 2052])).toBe('27 BCE – 476 CE')
  })
})

describe('formatGeoTimePrecise', () => {
  it('falls back to formatGeoTime when the precision adds nothing or is invalid', () => {
    for (const precision of [1e7, 0, Number.NaN]) expect(formatGeoTimePrecise(66_000_000, precision)).toBe('66 Ma')
    expect(formatGeoTimePrecise(533, 5)).toBe('1492')
    expect(formatGeoTimePrecise(0, 1e-9)).toBe('present')
  })

  it('prints just enough decimals of raw years to resolve the precision, capped', () => {
    expect(formatGeoTimePrecise(123_456.789, 0.01)).toBe('123,456.79 years ago')
    expect(formatGeoTimePrecise(66_043_000, 1e-9)).toBe('66,043,000.000000 years ago')
    const trio = [66_043_000, 66_042_999.99, 66_042_900].map((t) => formatGeoTimePrecise(t, 0.001))
    expect(new Set(trio).size).toBe(3)
  })

  it('resolves a calendar date to the exact year, then the month', () => {
    expect(formatGeoTimePrecise(10_000, 10)).toBe('7975 BCE')
    expect(formatGeoTimePrecise(0.5, 0.05)).toBe('Jul 2024')
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
