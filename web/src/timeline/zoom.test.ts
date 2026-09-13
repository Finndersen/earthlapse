import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { createSymlogScale, type TimeWindow } from './scale'
import { EVENT_FRAME_PADDING_FACTOR, frameEventWindow, MIN_SPAN_YEARS, panWindow, zoomWindow } from './zoom'

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

describe('panWindow', () => {
  it('keeps the span exactly constant', () => {
    const window: TimeWindow = [1e7, 2e7]
    const span = window[1] - window[0]
    const result = panWindow(window, 0.1, 'symlog')
    expect(result[1] - result[0]).toBeCloseTo(span, 3)
  })

  it('moves toward the present (smaller t) for positive deltaU', () => {
    const window: TimeWindow = [1e7, 2e7]
    const result = panWindow(window, 0.1, 'linear')
    expect(result[0]).toBeLessThan(window[0])
    expect(result[1]).toBeLessThan(window[1])
  })

  it('moves toward the past (larger t) for negative deltaU', () => {
    const window: TimeWindow = [1e7, 2e7]
    const result = panWindow(window, -0.1, 'linear')
    expect(result[0]).toBeGreaterThan(window[0])
    expect(result[1]).toBeGreaterThan(window[1])
  })

  it('slides rather than shrinks when panning off the present edge', () => {
    const window: TimeWindow = [0, 1000]
    const span = window[1] - window[0]
    const result = panWindow(window, 0.5, 'linear')
    expect(result[0]).toBe(0)
    expect(result[1] - result[0]).toBeCloseTo(span, 6)
  })

  it('never produces a window outside [0, EARTH_FORMATION]', () => {
    const result = panWindow([EARTH_FORMATION - 1000, EARTH_FORMATION], -1, 'symlog')
    expect(result[0]).toBeGreaterThanOrEqual(0)
    expect(result[1]).toBeLessThanOrEqual(EARTH_FORMATION)
  })

  it('rejects density, which is out of scope for this package', () => {
    expect(() => panWindow(FULL_DOMAIN, 0.1, 'density')).toThrow(/density/)
  })
})

describe('frameEventWindow', () => {
  it('includes the full band plus padding on each side', () => {
    const tMin = 2.5e8
    const tMax = 2.52e8
    const band = tMax - tMin
    const result = frameEventWindow(tMin, tMax)
    expect(result[0]).toBeCloseTo(tMin - band * EVENT_FRAME_PADDING_FACTOR, 6)
    expect(result[1]).toBeCloseTo(tMax + band * EVENT_FRAME_PADDING_FACTOR, 6)
    expect(result[0]).toBeLessThan(tMin)
    expect(result[1]).toBeGreaterThan(tMax)
  })

  it('still produces a non-degenerate window for a point event', () => {
    const result = frameEventWindow(1e6, 1e6)
    expect(result[1] - result[0]).toBeGreaterThan(0)
    expect(result[0]).toBeLessThanOrEqual(1e6)
    expect(result[1]).toBeGreaterThanOrEqual(1e6)
  })

  it('clamps to the domain near the present edge without losing the band', () => {
    const result = frameEventWindow(0, 100)
    expect(result[0]).toBeGreaterThanOrEqual(0)
    expect(result[0]).toBeLessThanOrEqual(0)
    expect(result[1]).toBeGreaterThanOrEqual(100)
  })

  it('rejects an inverted band', () => {
    expect(() => frameEventWindow(100, 0)).toThrow()
  })
})
