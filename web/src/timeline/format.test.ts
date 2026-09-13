import { describe, expect, it } from 'vitest'

import { formatGeoTime } from './format'

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
