import { describe, expect, it } from 'vitest'

import { hasExceededTapSlop, MARKER_TAP_SLOP_PX } from './markerGesture'

describe('hasExceededTapSlop', () => {
  it('is false for movement under the default slop, purely horizontal', () => {
    expect(hasExceededTapSlop(MARKER_TAP_SLOP_PX - 1, 0)).toBe(false)
  })

  it('is false exactly at the slop boundary (strictly greater-than, not greater-or-equal)', () => {
    expect(hasExceededTapSlop(MARKER_TAP_SLOP_PX, 0)).toBe(false)
  })

  it('is true just past the slop boundary', () => {
    expect(hasExceededTapSlop(MARKER_TAP_SLOP_PX + 0.01, 0)).toBe(true)
  })

  it('is euclidean, not axis-separate: two components each under the slop can still exceed it combined', () => {
    // 6-8-10 triangle: dx=6, dy=8 individually look small, but the straight-line distance is 10.
    expect(hasExceededTapSlop(6, 8, 8)).toBe(true)
  })

  it('treats negative deltas (movement left/up) the same as positive ones', () => {
    expect(hasExceededTapSlop(-3, -4)).toBe(false)
    expect(hasExceededTapSlop(-30, -40)).toBe(true)
  })
})
