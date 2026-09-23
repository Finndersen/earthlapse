import { useRef } from 'react'
import type { TouchEvent } from 'react'

/** How far a finger must travel sideways, and how much more sideways than vertical, for a touch
 *  to count as a swipe rather than a scroll or a tap. */
const MIN_DISTANCE_PX = 56
const MIN_HORIZONTAL_RATIO = 1.5

export type SwipeDirection = 'left' | 'right'

/** The direction of a single-finger touch that moved `dx`, `dy`, or `null` for anything that
 *  reads as a tap or a scroll. */
export function swipeDirection(dx: number, dy: number): SwipeDirection | null {
  if (Math.abs(dx) < MIN_DISTANCE_PX || Math.abs(dx) < MIN_HORIZONTAL_RATIO * Math.abs(dy)) return null
  return dx < 0 ? 'left' : 'right'
}

/** Touch handlers that call `onSwipe` once per horizontal swipe; spread them on the element. */
export function useSwipe(onSwipe: ((direction: SwipeDirection) => void) | undefined) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onTouchStart: (event: TouchEvent) => {
      const touch = event.touches.length === 1 ? event.touches[0] : undefined
      start.current = touch ? { x: touch.clientX, y: touch.clientY } : null
    },
    onTouchEnd: (event: TouchEvent) => {
      const from = start.current
      const touch = event.changedTouches[0]
      start.current = null
      if (!from || !touch || !onSwipe) return
      const direction = swipeDirection(touch.clientX - from.x, touch.clientY - from.y)
      if (direction) onSwipe(direction)
    },
  }
}
