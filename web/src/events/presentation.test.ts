import { describe, expect, it } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import {
  FEED_CARD_GAP_PX,
  FEED_CARD_HEIGHT_PX,
  FEED_OVERFLOW_LINE_PX,
  FEED_STRIP_HEIGHT_PX,
  FRESH_EMPHASIS_BAND,
  MAX_CARD_OFFSET_PX,
  MAX_FRESH_INSET_PX,
  feedCardCapacity,
  feedCardEmphases,
  feedCardInsetPx,
  feedCardOffsetPx,
  feedCardOpacity,
  feedStripCapacity,
} from './presentation'
import type { FeedEntry } from './select'

function entry(id: string, distanceFraction: number): FeedEntry {
  const event: TimelineEvent = { id, label: id, tMin: 0, tMax: 0, importance: 0.5, description: '', citation: '' }
  return { event, distanceFraction }
}

/** The exact height `n` collapsed cards plus the reserved "+k more" line occupy. */
function heightFor(cards: number): number {
  return cards * (FEED_CARD_HEIGHT_PX + FEED_CARD_GAP_PX) + FEED_OVERFLOW_LINE_PX
}

describe('feedCardOpacity', () => {
  it('is fully opaque at distanceFraction 0 and fully transparent at 1', () => {
    expect(feedCardOpacity(0)).toBe(1)
    expect(feedCardOpacity(1)).toBe(0)
  })

  it('clamps outside [0, 1]', () => {
    expect(feedCardOpacity(-1)).toBe(1)
    expect(feedCardOpacity(2)).toBe(0)
  })

  it('eases out rather than fading linearly', () => {
    expect(feedCardOpacity(0.5)).toBeCloseTo(0.75)
  })
})

describe('feedCardOffsetPx', () => {
  it('runs from 0 to MAX_CARD_OFFSET_PX across [0, 1]', () => {
    expect(feedCardOffsetPx(0)).toBe(0)
    expect(feedCardOffsetPx(1)).toBe(MAX_CARD_OFFSET_PX)
    expect(feedCardOffsetPx(0.5)).toBeCloseTo(MAX_CARD_OFFSET_PX / 2)
  })

  it('clamps outside [0, 1]', () => {
    expect(feedCardOffsetPx(-1)).toBe(0)
    expect(feedCardOffsetPx(2)).toBe(MAX_CARD_OFFSET_PX)
  })
})

describe('feedCardCapacity', () => {
  it('fits exactly as many cards as the height holds alongside the overflow line', () => {
    expect(feedCardCapacity(heightFor(3), 4)).toBe(3)
    expect(feedCardCapacity(heightFor(3) - 1, 4)).toBe(2)
  })

  it('caps at maxVisible however tall the slot is', () => {
    expect(feedCardCapacity(heightFor(10), 4)).toBe(4)
  })

  it('always leaves room for the freshest card, even in an unmeasured or squeezed slot', () => {
    expect(feedCardCapacity(0, 4)).toBe(1)
    expect(feedCardCapacity(FEED_CARD_HEIGHT_PX / 2, 4)).toBe(1)
  })
})

describe('feedStripCapacity', () => {
  it('fits the one-line strip once the row is at least as tall as it', () => {
    expect(feedStripCapacity(FEED_STRIP_HEIGHT_PX)).toBe(1)
    expect(feedStripCapacity(FEED_STRIP_HEIGHT_PX * 3)).toBe(1)
  })

  it('shows nothing in a row squeezed shorter than the strip, or not yet measured', () => {
    expect(feedStripCapacity(FEED_STRIP_HEIGHT_PX - 1)).toBe(0)
    expect(feedStripCapacity(0)).toBe(0)
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

  it('is flat at both ends of the band (smoothstep), so the handover never jumps', () => {
    const [nearStart] = feedCardEmphases([entry('a', FRESH_EMPHASIS_BAND * 0.02)])
    const [nearEnd] = feedCardEmphases([entry('a', FRESH_EMPHASIS_BAND * 0.98)])
    expect(nearStart).toBeGreaterThan(0.99)
    expect(nearEnd).toBeLessThan(0.01)
  })

  it('leaves a freshest card that has already receded past the band unemphasised', () => {
    expect(feedCardEmphases([entry('a', 0.8), entry('b', 0.9)])).toEqual([0, 0])
  })

  it('is a pure function of the selection: the same entries give the same emphasis', () => {
    const visible = [entry('a', 0.1), entry('b', 0.4)]
    expect(feedCardEmphases(visible)).toEqual(feedCardEmphases([...visible]))
  })

  it('returns nothing for an empty selection', () => {
    expect(feedCardEmphases([])).toEqual([])
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
