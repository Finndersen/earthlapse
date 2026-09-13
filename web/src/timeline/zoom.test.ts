import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { createSymlogScale, type TimeWindow } from './scale'
import { MIN_SPAN_YEARS, zoomWindow } from './zoom'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]

describe('zoomWindow', () => {
  it('narrows the span when factor > 1 and widens it when factor < 1', () => {
    const window: TimeWindow = [1e6, 1e8]
    const span = window[1] - window[0]
    const zoomedIn = zoomWindow(window, 0.5, 2, 'symlog')
    const zoomedOut = zoomWindow(window, 0.5, 0.5, 'symlog')
    expect(zoomedIn[1] - zoomedIn[0]).toBeLessThan(span)
    expect(zoomedOut[1] - zoomedOut[0]).toBeGreaterThan(span)
  })

  it('clamps span down to MIN_SPAN_YEARS and no further, at any zoom-in factor', () => {
    const window: TimeWindow = [1e6, 1e6 + 10]
    const result = zoomWindow(window, 0.5, 1e12, 'symlog')
    expect(result[1] - result[0]).toBeCloseTo(MIN_SPAN_YEARS, 6)
  })

  it('clamps span up to EARTH_FORMATION and no further, at any zoom-out factor', () => {
    const window: TimeWindow = [1e6, 2e6]
    const result = zoomWindow(window, 0.5, 1e-9, 'symlog')
    expect(result[0]).toBeCloseTo(0, 6)
    expect(result[1]).toBeCloseTo(EARTH_FORMATION, 6)
  })

  it('clamps the window to stay within [0, EARTH_FORMATION] when zooming out near an edge', () => {
    const window: TimeWindow = [0, 1e3]
    const result = zoomWindow(window, 0, 0.01, 'symlog')
    expect(result[0]).toBeGreaterThanOrEqual(0)
    expect(result[1]).toBeLessThanOrEqual(EARTH_FORMATION)
  })

  it('keeps the point under the cursor fixed when zooming in warped space', () => {
    const window: TimeWindow = [1e6, 1e8]
    const scale = createSymlogScale(window)
    const anchorU = 0.3
    const anchorT = scale.fromUnit(anchorU)

    const result = zoomWindow(window, anchorU, 3, 'symlog')
    const resultScale = createSymlogScale(result)
    expect(resultScale.toUnit(anchorT)).toBeCloseTo(anchorU, 6)
  })

  it('produces no NaN or overshoot for extreme factors and edge anchors (symlog)', () => {
    const window: TimeWindow = [0, EARTH_FORMATION]
    for (const anchorU of [0, 0.5, 1]) {
      for (const factor of [1e-12, 1e-6, 1, 1e6, 1e12]) {
        const [newest, oldest] = zoomWindow(window, anchorU, factor, 'symlog')
        expect(Number.isFinite(newest)).toBe(true)
        expect(Number.isFinite(oldest)).toBe(true)
        expect(newest).toBeGreaterThanOrEqual(0)
        expect(oldest).toBeLessThanOrEqual(EARTH_FORMATION)
        expect(newest).toBeLessThanOrEqual(oldest)
      }
    }
  })

  it('produces no NaN or overshoot for extreme factors and edge anchors (linear)', () => {
    const window: TimeWindow = [0, EARTH_FORMATION]
    for (const anchorU of [0, 0.5, 1]) {
      for (const factor of [1e-12, 1e-6, 1, 1e6, 1e12]) {
        const [newest, oldest] = zoomWindow(window, anchorU, factor, 'linear')
        expect(Number.isFinite(newest)).toBe(true)
        expect(Number.isFinite(oldest)).toBe(true)
        expect(newest).toBeGreaterThanOrEqual(0)
        expect(oldest).toBeLessThanOrEqual(EARTH_FORMATION)
        expect(newest).toBeLessThanOrEqual(oldest)
      }
    }
  })

  it('rejects a non-positive or non-finite factor', () => {
    expect(() => zoomWindow(FULL_DOMAIN, 0.5, 0, 'symlog')).toThrow()
    expect(() => zoomWindow(FULL_DOMAIN, 0.5, -1, 'symlog')).toThrow()
    expect(() => zoomWindow(FULL_DOMAIN, 0.5, Number.NaN, 'symlog')).toThrow()
  })

  it('rejects density, which is out of scope for this package', () => {
    expect(() => zoomWindow(FULL_DOMAIN, 0.5, 2, 'density')).toThrow(/density/)
  })
})
