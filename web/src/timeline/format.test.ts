import { describe, expect, it } from 'vitest'

import { formatGeoTime, formatTimeRange } from './format'

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
})
