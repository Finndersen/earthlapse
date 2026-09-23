'use client'

/**
 * A vertical detent picker: the selected value centred, its neighbours faint above and below, the
 * unit caption underneath. Detents run slower-to-faster top to bottom, the way a picker drum
 * lists ascending values, so dragging or wheeling the drum upward brings a faster value to the
 * centre. ArrowUp/PageUp/End move faster and ArrowDown/PageDown/Home slower, as a spinbutton's
 * do. A tap on the upper or lower neighbour steps to it.
 *
 * Drag follows the pointer continuously and snaps to the nearest detent on release; each detent
 * crossed along the way commits at once, so playback changes rate as the drum turns.
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'

import styles from './RateScroller.module.css'

export interface RateDetent {
  value: number
  /** The compact row label, e.g. `"500k"`. */
  label: string
  /** `aria-valuetext`, e.g. `"500 thousand years per second"`. */
  valueText: string
}

interface RateScrollerProps {
  detents: readonly RateDetent[]
  /** Index into `detents` of the selected value. */
  index: number
  onChange: (index: number) => void
  /** Accessible name. */
  label: string
  /** The unit under the rows, e.g. `"yr/s"`. */
  caption: string
  title?: string
}

/** Pointer travel per detent. Larger than the drawn row pitch so a fingertip can land on a detent
 *  without overshooting; the drum moves proportionally slower than the pointer. */
export const DRAG_PX_PER_DETENT = 18
/** Accumulated wheel travel per detent: one mouse notch (~100px) steps once, and a trackpad
 *  swipe steps about once per 40px of scroll. */
export const WHEEL_PX_PER_DETENT = 40
/** A press that moves less than this is a tap, not a drag. */
const TAP_SLOP_PX = 4
/** Detents moved by PageUp/PageDown. */
const PAGE_STEP = 3
/** Drawn row pitch, px — matches `.row`'s height in the stylesheet. */
const ROW_PX = 11

/** `index` clamped to `detents`, rounded to a whole detent. */
function clampIndex(index: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.round(index)))
}

interface DragState {
  pointerId: number
  startY: number
  startIndex: number
  moved: boolean
}

export function RateScroller({ detents, index, onChange, label, caption, title }: RateScrollerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const wheelRef = useRef(0)
  // The fractional drum position while dragging; `null` at rest, when the drum sits on `index`.
  const [dragPosition, setDragPosition] = useState<number | null>(null)

  const indexRef = useRef(index)
  indexRef.current = index
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const countRef = useRef(detents.length)
  countRef.current = detents.length

  const commit = (next: number): void => {
    const clamped = clampIndex(next, countRef.current)
    if (clamped !== indexRef.current) onChangeRef.current(clamped)
  }

  // Native and non-passive: React attaches `onWheel` passively, where `preventDefault` cannot
  // stop the page scrolling under the control.
  useEffect(() => {
    const el = rootRef.current
    if (el === null) return
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * 100 : e.deltaY
      if (Math.sign(delta) !== Math.sign(wheelRef.current)) wheelRef.current = 0
      wheelRef.current += delta
      if (Math.abs(wheelRef.current) >= WHEEL_PX_PER_DETENT) {
        commit(indexRef.current + Math.sign(wheelRef.current))
        wheelRef.current = 0
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // Registered once: `commit` reads only refs, so the first render's closure stays current.
  }, [])

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const last = detents.length - 1
    const target =
      e.key === 'ArrowUp'
        ? index + 1
        : e.key === 'ArrowDown'
          ? index - 1
          : e.key === 'PageUp'
            ? index + PAGE_STEP
            : e.key === 'PageDown'
              ? index - PAGE_STEP
              : e.key === 'End'
                ? last
                : e.key === 'Home'
                  ? 0
                  : null
    if (target === null) return
    // Handled here, so the timeline's own PageUp/Home section shortcuts do not also fire.
    e.preventDefault()
    e.stopPropagation()
    commit(target)
  }

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, startY: e.clientY, startIndex: index, moved: false }
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== e.pointerId) return
    const dy = e.clientY - drag.startY
    if (!drag.moved && Math.abs(dy) < TAP_SLOP_PX) return
    drag.moved = true
    // Upward drag (negative dy) turns the drum toward the faster detents below the centre.
    const position = Math.min(detents.length - 1, Math.max(0, drag.startIndex - dy / DRAG_PX_PER_DETENT))
    setDragPosition(position)
    commit(position)
  }

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    setDragPosition(null)
    if (cancelled || drag.moved) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.height <= 0) return
    const y = (e.clientY - rect.top) / rect.height
    if (y < 1 / 3) commit(index - 1)
    else if (y > 2 / 3) commit(index + 1)
  }

  const position = dragPosition ?? index
  const selected = detents[index]

  return (
    <div
      ref={rootRef}
      className={styles.scroller}
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={detents[0]?.value}
      aria-valuemax={detents[detents.length - 1]?.value}
      aria-valuenow={selected?.value}
      aria-valuetext={selected?.valueText}
      title={title}
      data-dragging={dragPosition !== null}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
    >
      <div className={styles.drum} aria-hidden="true">
        <div className={styles.rows} style={{ transform: `translateY(${(1 - position) * ROW_PX}px)` }}>
          {detents.map((detent, i) => (
            <span key={detent.value} className={styles.row} data-selected={i === index}>
              {detent.label}
            </span>
          ))}
        </div>
      </div>
      <span className={styles.caption} aria-hidden="true">
        {caption}
      </span>
    </div>
  )
}
