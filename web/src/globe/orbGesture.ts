/**
 * The minimised orb's click-vs-drag decision (`Globe.tsx`'s `onOrbPointerDown`/
 * `onOrbPointerUp`): OrbitControls rotates the globe on any drag, so a plain press-and-release
 * that expands it must be told apart from a drag by how far the pointer moved between press and
 * release, not by which element the events landed on (OrbitControls captures the pointer on the
 * canvas, so pointerup still bubbles to the orb wrapper with the right coordinates even when
 * released outside it). Pure and framework-free so the threshold behaviour is unit-testable
 * without mounting the canvas.
 */

export interface Point {
  x: number
  y: number
}

/** How far a press may move (px) and still count as a click-to-expand rather than a rotate
 *  drag, on the minimised orb. */
export const ORB_CLICK_DRAG_THRESHOLD_PX = 4

/** Whether a press that started at `start` and released at `end` reads as a click (true) or a
 *  drag (false) — the straight-line distance moved, compared against `thresholdPx`. */
export function isOrbClick(start: Point, end: Point, thresholdPx: number = ORB_CLICK_DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) < thresholdPx
}
