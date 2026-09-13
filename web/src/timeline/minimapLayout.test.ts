import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import {
  BRACKET_NEARLY_FULL_THRESHOLD,
  bracketUnitSpan,
  isBracketNearlyFullDomain,
  minimapBracket,
  MIN_BRACKET_PX,
  panBracket,
} from './minimapLayout'
import { createSymlogScale, type TimeWindow } from './scale'

const TRACK_WIDTH = 800

describe('minimapBracket', () => {
  it('maps the full domain to the full track width', () => {
    const { leftPx, widthPx } = minimapBracket([0, EARTH_FORMATION], TRACK_WIDTH)
    expect(leftPx).toBeCloseTo(0, 6)
    expect(widthPx).toBeCloseTo(TRACK_WIDTH, 6)
  })

  it('places a mid-domain window using the full-domain symlog warp, not a linear one', () => {
    const window: TimeWindow = [1e6, 1e8]
    const scale = createSymlogScale([0, EARTH_FORMATION])
    const { leftPx, widthPx } = minimapBracket(window, TRACK_WIDTH)
    const expectedLeft = scale.toUnit(window[1]) * TRACK_WIDTH
    const expectedWidth = (scale.toUnit(window[0]) - scale.toUnit(window[1])) * TRACK_WIDTH
    expect(leftPx).toBeCloseTo(expectedLeft, 6)
    expect(widthPx).toBeCloseTo(expectedWidth, 6)
  })

  it('never renders narrower than MIN_BRACKET_PX for a very narrow window', () => {
    const window: TimeWindow = [1e8, 1e8 + 1]
    const { widthPx } = minimapBracket(window, TRACK_WIDTH)
    expect(widthPx).toBe(MIN_BRACKET_PX)
  })

  it('centres the widened bracket on the window’s true midpoint', () => {
    const window: TimeWindow = [1e8, 1e8 + 1]
    const scale = createSymlogScale([0, EARTH_FORMATION])
    const trueCenterPx = ((scale.toUnit(window[0]) + scale.toUnit(window[1])) / 2) * TRACK_WIDTH
    const { leftPx, widthPx } = minimapBracket(window, TRACK_WIDTH)
    expect(leftPx + widthPx / 2).toBeCloseTo(trueCenterPx, 3)
  })

  it('keeps the widened bracket fully on the track near an edge', () => {
    const nearPresent: TimeWindow = [0, 1]
    const { leftPx, widthPx } = minimapBracket(nearPresent, TRACK_WIDTH)
    expect(leftPx).toBeGreaterThanOrEqual(0)
    expect(leftPx + widthPx).toBeLessThanOrEqual(TRACK_WIDTH)

    const nearOldest: TimeWindow = [EARTH_FORMATION - 1, EARTH_FORMATION]
    const other = minimapBracket(nearOldest, TRACK_WIDTH)
    expect(other.leftPx).toBeGreaterThanOrEqual(0)
    expect(other.leftPx + other.widthPx).toBeLessThanOrEqual(TRACK_WIDTH)
  })

  it('degrades to a zero-size bracket for a non-positive track width', () => {
    expect(minimapBracket([0, EARTH_FORMATION], 0)).toEqual({ leftPx: 0, widthPx: 0 })
  })
})

describe('panBracket (defect a regression: warped-space pan tracks the cursor exactly)', () => {
  it('keeps the bracket pixel width (u-span) exactly constant across a pan, unlike a naive raw-year shift', () => {
    const window: TimeWindow = [1e5, 5e5]
    const deltaU = 80 / TRACK_WIDTH
    const before = minimapBracket(window, TRACK_WIDTH)
    const panned = panBracket(window, deltaU)
    const after = minimapBracket(panned, TRACK_WIDTH)
    expect(after.widthPx).toBeCloseTo(before.widthPx, 6)
  })

  it('moves the bracket left edge by exactly the requested pixel delta', () => {
    const window: TimeWindow = [1e5, 5e5]
    const deltaPx = 80
    const before = minimapBracket(window, TRACK_WIDTH)
    const panned = panBracket(window, deltaPx / TRACK_WIDTH)
    const after = minimapBracket(panned, TRACK_WIDTH)
    expect(after.leftPx - before.leftPx).toBeCloseTo(deltaPx, 6)
  })

  it('positive deltaU pans toward the present (both bounds decrease)', () => {
    const window: TimeWindow = [1e5, 5e5]
    const [newest, oldest] = panBracket(window, 0.05)
    expect(newest).toBeLessThan(window[0])
    expect(oldest).toBeLessThan(window[1])
  })

  it('negative deltaU pans toward the past (both bounds increase)', () => {
    const window: TimeWindow = [1e5, 5e5]
    const [newest, oldest] = panBracket(window, -0.05)
    expect(newest).toBeGreaterThan(window[0])
    expect(oldest).toBeGreaterThan(window[1])
  })

  it('slides rather than shrinks the bracket at the present-day edge', () => {
    const window: TimeWindow = [0, 1e5]
    const spanU = bracketUnitSpan(window)
    const [newest] = panBracket(window, 0.5)
    expect(newest).toBeCloseTo(0, 6)
    expect(bracketUnitSpan(panBracket(window, 0.5))).toBeCloseTo(spanU, 6)
  })

  it('slides rather than shrinks the bracket at the oldest edge', () => {
    const window: TimeWindow = [EARTH_FORMATION - 1e5, EARTH_FORMATION]
    const spanU = bracketUnitSpan(window)
    const [, oldest] = panBracket(window, -0.5)
    expect(oldest).toBeCloseTo(EARTH_FORMATION, 3)
    expect(bracketUnitSpan(panBracket(window, -0.5))).toBeCloseTo(spanU, 6)
  })
})

describe('isBracketNearlyFullDomain', () => {
  it('is false for a comfortably-sized window', () => {
    expect(isBracketNearlyFullDomain([1e5, 5e5])).toBe(false)
  })

  it('is true for the exact full domain', () => {
    expect(isBracketNearlyFullDomain([0, EARTH_FORMATION])).toBe(true)
  })

  it('is true just above the threshold and false just below it', () => {
    const scale = createSymlogScale([0, EARTH_FORMATION])
    const oldestJustAbove = scale.fromUnit(1 - (BRACKET_NEARLY_FULL_THRESHOLD + 1e-4))
    const oldestJustBelow = scale.fromUnit(1 - (BRACKET_NEARLY_FULL_THRESHOLD - 1e-4))
    expect(isBracketNearlyFullDomain([0, oldestJustAbove])).toBe(true)
    expect(isBracketNearlyFullDomain([0, oldestJustBelow])).toBe(false)
  })
})
