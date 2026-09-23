import { describe, expect, it } from 'vitest'

import { isOrbClick, ORB_CLICK_DRAG_THRESHOLD_PX } from './orbGesture'

describe('isOrbClick', () => {
  it('is a click when the pointer never moved', () => {
    expect(isOrbClick({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true)
  })

  it('is a drag at or beyond the threshold', () => {
    expect(isOrbClick({ x: 0, y: 0 }, { x: ORB_CLICK_DRAG_THRESHOLD_PX, y: 0 })).toBe(false)
    expect(isOrbClick({ x: 0, y: 0 }, { x: ORB_CLICK_DRAG_THRESHOLD_PX + 5, y: 0 })).toBe(false)
  })

  it('measures straight-line distance, not per-axis', () => {
    // 3-4-5 triangle: each axis moves less than the threshold alone, but the combined
    // distance (5) exceeds it.
    expect(isOrbClick({ x: 0, y: 0 }, { x: 3, y: 4 }, 4.5)).toBe(false)
    expect(isOrbClick({ x: 0, y: 0 }, { x: 3, y: 4 }, 5.5)).toBe(true)
  })

})
