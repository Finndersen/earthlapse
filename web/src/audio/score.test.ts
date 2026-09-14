import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { scoreParams } from './score'

const NO_SERIES = { co2Ppm: null, dayLengthHours: null }
const NO_CATASTROPHES: never[] = []

describe('scoreParams', () => {
  it('rootHz is one octave lower at Earth formation than at present', () => {
    const present = scoreParams(0, NO_SERIES, NO_CATASTROPHES).rootHz
    const deepPast = scoreParams(EARTH_FORMATION, NO_SERIES, NO_CATASTROPHES).rootHz
    expect(present).toBeCloseTo(55, 5)
    expect(deepPast).toBeCloseTo(27.5, 5)
  })

  it('rootHz glides monotonically between the two', () => {
    const values = [0, 1e8, 1e9, EARTH_FORMATION].map((t) => scoreParams(t, NO_SERIES, NO_CATASTROPHES).rootHz)
    for (let i = 1; i < values.length; i++) {
      expect(values[i]!).toBeLessThanOrEqual(values[i - 1]!)
    }
  })

  it('higher co2 lowers the filter cutoff; null falls back to the present-day default', () => {
    const low = scoreParams(0, { co2Ppm: 200, dayLengthHours: null }, NO_CATASTROPHES).filterCutoffHz
    const high = scoreParams(0, { co2Ppm: 6000, dayLengthHours: null }, NO_CATASTROPHES).filterCutoffHz
    const fallback = scoreParams(0, NO_SERIES, NO_CATASTROPHES).filterCutoffHz
    const explicit420 = scoreParams(0, { co2Ppm: 420, dayLengthHours: null }, NO_CATASTROPHES).filterCutoffHz

    expect(high).toBeLessThan(low)
    expect(fallback).toBeCloseTo(explicit420, 5)
    expect(fallback).toBeGreaterThanOrEqual(400)
    expect(fallback).toBeLessThanOrEqual(4000)
  })

  it('filter cutoff always stays in the musical range, even for out-of-range co2', () => {
    expect(scoreParams(0, { co2Ppm: 0, dayLengthHours: null }, NO_CATASTROPHES).filterCutoffHz).toBe(4000)
    expect(scoreParams(0, { co2Ppm: 1e6, dayLengthHours: null }, NO_CATASTROPHES).filterCutoffHz).toBe(400)
  })

  it('shorter days drive a faster pulse; null falls back to the present-day 24h default', () => {
    const shortDay = scoreParams(0, { co2Ppm: null, dayLengthHours: 6 }, NO_CATASTROPHES).pulseHz
    const longDay = scoreParams(0, { co2Ppm: null, dayLengthHours: 24 }, NO_CATASTROPHES).pulseHz
    const fallback = scoreParams(0, NO_SERIES, NO_CATASTROPHES).pulseHz

    expect(shortDay).toBeGreaterThan(longDay)
    expect(fallback).toBeCloseTo(longDay, 5)
    expect(fallback).toBeGreaterThanOrEqual(0.1)
    expect(fallback).toBeLessThanOrEqual(2)
  })

  it('dissonance is 0 far from any catastrophe window and rises near one', () => {
    const window = { tMin: 6.6e7, tMax: 6.61e7 }
    const far = scoreParams(0, NO_SERIES, [window]).dissonance
    const mid = (window.tMin + window.tMax) / 2
    const near = scoreParams(mid, NO_SERIES, [window]).dissonance

    expect(far).toBe(0)
    expect(near).toBeCloseTo(1, 5)
  })

  it('dissonance sums multiple nearby windows but never exceeds 1', () => {
    const windows = [
      { tMin: 6.6e7, tMax: 6.61e7 },
      { tMin: 6.6e7, tMax: 6.61e7 },
    ]
    const mid = (windows[0]!.tMin + windows[0]!.tMax) / 2
    expect(scoreParams(mid, NO_SERIES, windows).dissonance).toBeLessThanOrEqual(1)
  })
})
