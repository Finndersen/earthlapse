import { describe, expect, it } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import {
  FRESH_EMPHASIS_BAND,
  MAX_FRESH_INSET_PX,
  MIN_CARD_OPACITY,
  feedCardEmphases,
  feedCardInsetPx,
  feedCardOpacity,
} from './presentation'
import type { FeedEntry } from './select'

function entry(id: string, distanceFraction: number): FeedEntry {
  const event: TimelineEvent = { id, label: id, tMin: 0, tMax: 0, importance: 0.5, description: '', citation: '' }
  return { event, distanceFraction, members: [event] }
}

describe('feedCardOpacity', () => {
  it('is fully opaque at distanceFraction 0 and settled at MIN_CARD_OPACITY by 1', () => {
    expect(feedCardOpacity(0)).toBe(1)
    expect(feedCardOpacity(1)).toBeCloseTo(MIN_CARD_OPACITY)
  })

  it('keeps a long-retained card readable, never dimming past MIN_CARD_OPACITY', () => {
    expect(feedCardOpacity(2)).toBeCloseTo(MIN_CARD_OPACITY)
    expect(feedCardOpacity(100)).toBeCloseTo(MIN_CARD_OPACITY)
    expect(MIN_CARD_OPACITY).toBeGreaterThan(0.5)
  })

  it('eases out rather than fading linearly', () => {
    const linear = 1 - (1 - MIN_CARD_OPACITY) * 0.5
    expect(feedCardOpacity(0.5)).toBeGreaterThan(linear)
    expect(feedCardOpacity(0.5)).toBeCloseTo(0.9)
  })
})

describe('feedCardEmphases', () => {
  it('emphasises only the freshest card, fully as the playhead reaches it', () => {
    expect(feedCardEmphases([entry('a', 0), entry('b', 0), entry('c', 0.1)])).toEqual([1, 0, 0])
  })

  it('eases away across FRESH_EMPHASIS_BAND rather than switching off at a threshold', () => {
    const [start] = feedCardEmphases([entry('a', 0)])
    const [early] = feedCardEmphases([entry('a', FRESH_EMPHASIS_BAND * 0.25)])
    const [middle] = feedCardEmphases([entry('a', FRESH_EMPHASIS_BAND * 0.5)])
    const [late] = feedCardEmphases([entry('a', FRESH_EMPHASIS_BAND * 0.75)])
    const [settled] = feedCardEmphases([entry('a', FRESH_EMPHASIS_BAND)])

    expect(start).toBe(1)
    expect(middle).toBeCloseTo(0.5)
    expect(start).toBeGreaterThan(early!)
    expect(early).toBeGreaterThan(middle!)
    expect(middle).toBeGreaterThan(late!)
    expect(late).toBeGreaterThan(settled!)
    expect(settled).toBe(0)
  })

  it('leaves a freshest card that has already receded past the band unemphasised', () => {
    expect(feedCardEmphases([entry('a', 0.8), entry('b', 0.9)])).toEqual([0, 0])
  })

})

describe('feedCardInsetPx', () => {
  it('runs from 0 to MAX_FRESH_INSET_PX across emphasis [0, 1], clamped', () => {
    expect(feedCardInsetPx(0)).toBe(0)
    expect(feedCardInsetPx(1)).toBe(MAX_FRESH_INSET_PX)
    expect(feedCardInsetPx(-1)).toBe(0)
    expect(feedCardInsetPx(2)).toBe(MAX_FRESH_INSET_PX)
  })
})
