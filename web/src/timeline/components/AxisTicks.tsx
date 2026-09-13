'use client'

/** Nice, non-overlapping labels under the scrub track, and — per the brief — a drag-to-pan
 *  affordance: grabbing the ruler and dragging it pans the window in warped space, exactly like
 *  shift+wheel/horizontal-wheel on the track itself (`panWindow`), just via a pointer gesture
 *  instead. The "which ticks, where" layout logic itself stays in `ticks.ts`; this only adds
 *  the drag on top and renders what that returns, clamping the two edge labels via
 *  `tickLabelAlign` so a tick like "present" at `u = 1` never renders clipped outside the
 *  track. */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import type { TimeScale } from '@/types/layer'

import type { TimeWindow } from '../scale'
import { generateTicks, tickLabelAlign } from '../ticks'
import { useTrackWidth } from '../useTrackWidth'
import { panWindow } from '../zoom'
import styles from './AxisTicks.module.css'

interface AxisTicksProps {
  window: TimeWindow
  scale: TimeScale
  scaleKind: 'symlog' | 'linear'
  onWindowChange: (window: TimeWindow) => void
}

const ALIGN_TRANSFORM: Record<ReturnType<typeof tickLabelAlign>, string> = {
  start: 'translateX(0)',
  center: 'translateX(-50%)',
  end: 'translateX(-100%)',
}

interface DragState {
  pointerId: number
  startClientX: number
  startWindow: TimeWindow
}

export function AxisTicks({ window: visibleWindow, scale, scaleKind, onWindowChange }: AxisTicksProps) {
  const [ref, widthPx] = useTrackWidth<HTMLDivElement>()
  const ticks = useMemo(() => generateTicks(visibleWindow, scale, widthPx), [visibleWindow, scale, widthPx])

  const dragRef = useRef<DragState | null>(null)
  const [dragging, setDragging] = useState(false)

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, startClientX: e.clientX, startWindow: visibleWindow }
    setDragging(true)
  }, [visibleWindow])

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== e.pointerId || widthPx === 0) return
      // "Grab" semantics — content follows the cursor 1:1 — is the opposite sign from
      // `panWindow`'s own "camera pans toward the present" convention (dragging right should
      // pull recent-side content rightward with the cursor, which means the *window* slides
      // toward the past; see `panWindow`'s doc comment for the camera-pan derivation this
      // negates). Always from the drag's fixed start window, not the latest one, so repeated
      // moves within one gesture compound correctly without drift.
      const deltaPx = e.clientX - drag.startClientX
      onWindowChange(panWindow(drag.startWindow, -deltaPx / widthPx, scaleKind))
    },
    [onWindowChange, scaleKind, widthPx],
  )

  const handlePointerUp = useCallback((): void => {
    dragRef.current = null
    setDragging(false)
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden
      className={`${styles.ticks} ${dragging ? styles.dragging : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {ticks.map((tick) => (
        <span
          key={tick.t}
          className={styles.label}
          style={{
            left: `${tick.u * 100}%`,
            transform: ALIGN_TRANSFORM[tickLabelAlign(tick.u, tick.label, widthPx)],
          }}
        >
          {tick.label}
        </span>
      ))}
    </div>
  )
}
