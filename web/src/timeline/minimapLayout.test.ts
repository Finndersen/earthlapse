import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { minimapBracket, MIN_BRACKET_PX } from './minimapLayout'
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
