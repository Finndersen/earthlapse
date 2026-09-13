'use client'

/** "A persistent linear-scale minimap under the main axis keeps the warp legible and the
 *  distortion honest" (DESIGN §3). Always linear regardless of the main track's scale
 *  toggle — that is the entire point of it. */

import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import { EARTH_FORMATION } from '@/types/layer'

import { createLinearScale, type TimeWindow } from '../scale'
import { clamp } from '../util'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]

interface MinimapProps {
  window: TimeWindow
  onWindowChange: (window: TimeWindow) => void
}

export function Minimap({ window: visibleWindow, onWindowChange }: MinimapProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const scale = createLinearScale(FULL_DOMAIN)

  const startU = scale.toUnit(visibleWindow[1])
  const endU = scale.toUnit(visibleWindow[0])

  const recenterAt = (clientX: number): void => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return
    const u = clamp((clientX - rect.left) / rect.width, 0, 1)
    const centerT = scale.fromUnit(u)
    const span = visibleWindow[1] - visibleWindow[0]

    let newest = centerT - span / 2
    let oldest = centerT + span / 2
    if (newest < 0) {
      oldest -= newest
      newest = 0
    }
    if (oldest > EARTH_FORMATION) {
      newest -= oldest - EARTH_FORMATION
      oldest = EARTH_FORMATION
    }
    onWindowChange([clamp(newest, 0, EARTH_FORMATION), clamp(oldest, 0, EARTH_FORMATION)])
  }

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    recenterAt(e.clientX)
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.buttons === 0) return
    recenterAt(e.clientX)
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Visible window"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={(startU + endU) / 2}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      style={{
        position: 'relative',
        height: 6,
        background: 'rgba(255,255,255,0.08)',
        borderRadius: 3,
        cursor: 'pointer',
        touchAction: 'none',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: `${startU * 100}%`,
          width: `${Math.max(endU - startU, 0.002) * 100}%`,
          top: 0,
          bottom: 0,
          background: 'rgba(255,255,255,0.55)',
          borderRadius: 3,
        }}
      />
    </div>
  )
}
