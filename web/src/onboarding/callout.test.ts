import { describe, expect, it } from 'vitest'

import { placeCallout, type Rect, type Size } from './callout'

const DESKTOP: Size = { width: 1440, height: 900 }
const PHONE: Size = { width: 412, height: 870 }
const CARD: Size = { width: 320, height: 180 }

/** A target's box, viewport-relative. */
function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height }
}

describe('placeCallout', () => {
  it('sits below a target with room under it', () => {
    const placement = placeCallout(rect(600, 100, 200, 40), CARD, DESKTOP)
    expect(placement.side).toBe('below')
    expect(placement.top).toBeGreaterThan(140)
  })

  it('sits above a target near the bottom edge, where nothing fits underneath', () => {
    const placement = placeCallout(rect(600, 820, 200, 40), CARD, DESKTOP)
    expect(placement.side).toBe('above')
    expect(placement.top + CARD.height).toBeLessThanOrEqual(820)
  })

  it('goes beside a target only when neither above nor below has room', () => {
    // Full-height target: no vertical room on either side, plenty to its right.
    const placement = placeCallout(rect(40, 0, 120, 900), CARD, DESKTOP)
    expect(placement.side).toBe('right')
    expect(placement.left).toBeGreaterThanOrEqual(160)
  })

  it('keeps the card on screen when centring would push it past a viewport edge', () => {
    const placement = placeCallout(rect(0, 100, 60, 60), CARD, PHONE)
    expect(placement.left).toBeGreaterThanOrEqual(12)
    expect(placement.left + CARD.width).toBeLessThanOrEqual(PHONE.width - 12)
  })

  it('stays on screen even when the card fits on no side at all', () => {
    const tall: Size = { width: 320, height: 700 }
    const placement = placeCallout(rect(160, 400, 92, 92), tall, PHONE)
    expect(placement.left).toBeGreaterThanOrEqual(12)
    expect(placement.top).toBeGreaterThanOrEqual(12)
    expect(placement.top + tall.height).toBeLessThanOrEqual(PHONE.height)
  })
})
