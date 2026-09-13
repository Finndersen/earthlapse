'use client'

/** The main scrub track: pointer-drag scrubbing, wheel-to-zoom, event uncertainty bands with
 *  LOD fade, and the playhead. */

import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'

import type { GeoTime, TimeScale, TimelineEvent } from '@/types/layer'

import { minImportanceForSpan, visibleEvents } from '../lod'
import type { TimeWindow } from '../scale'
import { clamp, clampUnit } from '../util'
import { zoomWindow } from '../zoom'

/** Wheel `deltaY` -> zoom `factor`, tuned so a typical mouse-wheel notch (~100) changes span
 *  by roughly 15%. */
const ZOOM_SENSITIVITY = 0.0015

/** Importance units above the LOD threshold over which a freshly-revealed event ramps from
 *  transparent to fully opaque, so events pop in as a fade rather than a hard cut. */
const FADE_BAND = 0.12

interface ScrubTrackProps {
  t: GeoTime
  window: TimeWindow
  scale: TimeScale
  scaleKind: 'symlog' | 'linear'
  events: readonly TimelineEvent[]
  onScrub: (t: GeoTime) => void
  onWindowChange: (window: TimeWindow) => void
}

export function ScrubTrack({
  t,
  window: visibleWindow,
  scale,
  scaleKind,
  events,
  onScrub,
  onWindowChange,
}: ScrubTrackProps) {
  const trackRef = useRef<HTMLDivElement>(null)

  const uFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return 0
    return clampUnit((clientX - rect.left) / rect.width)
  }, [])

  const scrubToClientX = useCallback(
    (clientX: number): void => onScrub(scale.fromUnit(uFromClientX(clientX))),
    [onScrub, scale, uFromClientX],
  )

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubToClientX(e.clientX)
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.buttons === 0) return
    scrubToClientX(e.clientX)
  }

  const handleWheel = (e: ReactWheelEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const anchorU = uFromClientX(e.clientX)
    const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY)
    onWindowChange(zoomWindow(visibleWindow, anchorU, factor, scaleKind))
  }

  const spanYears = visibleWindow[1] - visibleWindow[0]
  const threshold = minImportanceForSpan(spanYears)
  const shown = visibleEvents(events, visibleWindow, spanYears)
  const playheadU = clampUnit(scale.toUnit(t))

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Scrub timeline"
      aria-valuemin={visibleWindow[0]}
      aria-valuemax={visibleWindow[1]}
      aria-valuenow={t}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onWheel={handleWheel}
      style={{
        position: 'relative',
        height: 40,
        borderRadius: 4,
        background: 'rgba(255,255,255,0.06)',
        touchAction: 'none',
        cursor: 'ew-resize',
      }}
    >
      {shown.map((event) => {
        const uStart = clamp(scale.toUnit(event.tMax), 0, 1)
        const uEnd = clamp(scale.toUnit(event.tMin), 0, 1)
        const opacity = clampUnit((event.importance - threshold) / FADE_BAND)
        return (
          <div
            key={event.id}
            title={event.label}
            style={{
              position: 'absolute',
              left: `${uStart * 100}%`,
              width: `${Math.max(uEnd - uStart, 0.002) * 100}%`,
              top: 6,
              bottom: 6,
              background: 'rgba(120,190,255,0.55)',
              opacity,
              borderRadius: 2,
              pointerEvents: 'none',
            }}
          />
        )
      })}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: `${playheadU * 100}%`,
          top: 0,
          bottom: 0,
          width: 2,
          marginLeft: -1,
          background: '#fff',
          boxShadow: '0 0 6px rgba(255,255,255,0.8)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
