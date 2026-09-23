import { describe, expect, it } from 'vitest'

import { formatCalendarYear, formatGeoTime, formatGeoTimePrecise, formatRate, formatTimeRange } from './format'

describe('formatGeoTime', () => {
  it('formats the present as "present"', () => {
    expect(formatGeoTime(0)).toBe('present')
  })

  it('formats a year count as "N years ago"', () => {
    expect(formatGeoTime(250)).toBe('250 years ago')
  })

  it('uses the singular for exactly 1 year', () => {
    expect(formatGeoTime(1)).toBe('1 year ago')
  })

  it('formats thousands of years as ka, to one decimal', () => {
    expect(formatGeoTime(11_700)).toBe('11.7 ka')
  })

  it('formats millions of years as Ma, as a whole number', () => {
    expect(formatGeoTime(66_000_000)).toBe('66 Ma')
  })

  it('formats billions of years as Ga, to two decimals', () => {
    expect(formatGeoTime(4.567e9)).toBe('4.57 Ga')
  })

  it('trims a trailing .0 rather than printing a spurious decimal', () => {
    expect(formatGeoTime(10_000)).toBe('10 ka')
  })

  it('rejects negative t', () => {
    expect(() => formatGeoTime(-1)).toThrow()
  })

  it('rejects non-finite t', () => {
    expect(() => formatGeoTime(Number.NaN)).toThrow()
    expect(() => formatGeoTime(Infinity)).toThrow()
  })
})

describe('formatTimeRange', () => {
  it('renders a window touching the present as "<oldest> – present"', () => {
    expect(formatTimeRange([0, 1.17e4])).toBe('11.7 ka – present')
  })

  it('collapses to a single formatGeoTime when both edges are equal', () => {
    expect(formatTimeRange([0, 0])).toBe('present')
    expect(formatTimeRange([6.6e7, 6.6e7])).toBe('66 Ma')
  })

  it('shares one Ma suffix, older value first, when both edges are in the Ma bucket', () => {
    expect(formatTimeRange([2.01e8, 2.52e8])).toBe('252–201 Ma')
  })

  it('shares one Ga suffix when both edges are in the Ga bucket', () => {
    expect(formatTimeRange([4e9, 4.5e9])).toBe('4.5–4 Ga')
  })

  it('falls back to two full formatGeoTime strings across different buckets', () => {
    expect(formatTimeRange([250, 1.17e4])).toBe('11.7 ka – 250 years ago')
  })

  it('never shares a bare unit-less number across the sub-millennium band', () => {
    expect(formatTimeRange([10, 250])).toBe('250 years ago – 10 years ago')
  })

  it('collapses to a single value when unequal edges round to the same printed number in a shared bucket (re-review fix, 2026-09-15)', () => {
    // The K-Pg trio: [66,000,000, 66,043,000] both round to "66 Ma" under formatTimeRange's own
    // whole-number-Ma rounding, so it must read "66 Ma", not the misleading "66–66 Ma".
    expect(formatTimeRange([6.6e7, 6.6043e7])).toBe('66 Ma')
    // A genuine range in the same bucket that does *not* round together still shows both edges.
    expect(formatTimeRange([6.6e7, 6.7e7])).toBe('67–66 Ma')
  })
})

describe('formatGeoTimePrecise', () => {
  it('falls back to formatGeoTime when the pixel budget is no finer than the bucket already resolves', () => {
    expect(formatGeoTimePrecise(66_000_000, 1e7)).toBe(formatGeoTime(66_000_000))
    expect(formatGeoTimePrecise(12_345, 100)).toBe(formatGeoTime(12_345))
  })

  it('falls back to formatGeoTime for a non-positive or non-finite precision', () => {
    expect(formatGeoTimePrecise(66_000_000, 0)).toBe(formatGeoTime(66_000_000))
    expect(formatGeoTimePrecise(66_000_000, -1)).toBe(formatGeoTime(66_000_000))
    expect(formatGeoTimePrecise(66_000_000, Number.NaN)).toBe(formatGeoTime(66_000_000))
  })

  it('always formats present as "present", regardless of precision', () => {
    expect(formatGeoTimePrecise(0, 1e-9)).toBe('present')
  })

  it('resolves the K-Pg trio to distinct readouts once the pixel budget is sub-year, unlike the shared "66 Ma" formatGeoTime gives all three', () => {
    const arrival = formatGeoTimePrecise(66_043_000, 0.001)
    const darkness = formatGeoTimePrecise(66_042_999.99, 0.001)
    const aftermath = formatGeoTimePrecise(66_042_900, 0.001)
    expect(new Set([arrival, darkness, aftermath]).size).toBe(3)
    expect(darkness).toBe('66,042,999.990 years ago')
  })

  it('picks just enough decimals of raw years to resolve the given precision', () => {
    expect(formatGeoTimePrecise(12_345, 50)).toBe('12,345 years ago')
    expect(formatGeoTimePrecise(123.456, 0.01)).toBe('123.46 years ago')
  })

  it('caps the decimal count rather than printing an absurd number of digits for a vanishingly small precision', () => {
    expect(formatGeoTimePrecise(66_043_000, 1e-9)).toBe('66,043,000.000000 years ago')
  })

  it('rejects negative or non-finite t, matching formatGeoTime', () => {
    expect(() => formatGeoTimePrecise(-1, 1)).toThrow()
    expect(() => formatGeoTimePrecise(Number.NaN, 1)).toThrow()
  })
})

describe('formatRate', () => {
  it('formats rates under 10 yr/s to two significant figures', () => {
    expect(formatRate(2.5)).toBe('2.5 yr/s')
    expect(formatRate(0.13)).toBe('0.13 yr/s')
    expect(formatRate(9.4)).toBe('9.4 yr/s')
  })

  it('reads a smoothed rate at the 1 yr/s detent as "1 yr/s"', () => {
    expect(formatRate(0.998)).toBe('1 yr/s')
    expect(formatRate(1.004)).toBe('1 yr/s')
  })

  it('bounds a rate too small to print meaningfully, and prints zero as zero', () => {
    expect(formatRate(0.004)).toBe('< 0.01 yr/s')
    expect(formatRate(0)).toBe('0 yr/s')
  })

  it('formats tens and hundreds of years per second as a whole number', () => {
    expect(formatRate(42)).toBe('42 yr/s')
    expect(formatRate(9.97)).toBe('10 yr/s')
  })

  it('formats thousands of years per second as kyr/s, to one decimal', () => {
    expect(formatRate(2.1e5)).toBe('210 kyr/s')
  })

  it('formats millions of years per second as Myr/s, as a whole number', () => {
    expect(formatRate(4e7)).toBe('40 Myr/s')
  })

  it('formats billions of years per second as Gyr/s, to two decimals', () => {
    expect(formatRate(3.2e9)).toBe('3.2 Gyr/s')
  })

  it('rejects negative or non-finite rates', () => {
    expect(() => formatRate(-1)).toThrow()
    expect(() => formatRate(Number.NaN)).toThrow()
    expect(() => formatRate(Infinity)).toThrow()
  })
})

describe('formatCalendarYear', () => {
  it('renders recent ages as calendar years', () => {
    expect(formatCalendarYear(10)).toBe('2015 CE')
    expect(formatCalendarYear(533)).toBe('1492 CE')
    expect(formatCalendarYear(0)).toBe('2025 CE')
  })

  it('crosses into BCE without a year zero', () => {
    expect(formatCalendarYear(2025)).toBe('1 BCE')
    expect(formatCalendarYear(2024)).toBe('1 CE')
    expect(formatCalendarYear(2225)).toBe('201 BCE')
  })

  it('returns null above the calendar horizon, where elapsed time reads better', () => {
    expect(formatCalendarYear(3001)).toBeNull()
    expect(formatCalendarYear(1.2e4)).toBeNull()
  })

  it('refuses a non-finite age', () => {
    expect(() => formatCalendarYear(Number.NaN)).toThrow()
  })
})
