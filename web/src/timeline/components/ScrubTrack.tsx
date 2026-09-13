'use client'

/** The main scrub track: pointer-drag scrubbing, wheel-to-zoom, event uncertainty bands with
 *  LOD fade, scene checkpoint pips, and the playhead. A luminous hairline baseline rather than
 *  a filled panel, per the shared visual language — the hit area (`.hitArea`) stays taller
 *  than anything drawn inside it so the track stays easy to grab. */

import { useCallback, useMemo } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'

import type { GeoTime, TimeScale, TimelineEvent } from '@/types/layer'

import { layoutCheckpointPips } from '../checkpointLayout'
import type { TimelineCheckpoint } from '../checkpoints'
import { formatGeoTime } from '../format'
import { minImportanceForSpan, visibleEvents } from '../lod'
import type { TimeWindow } from '../scale'
import { useTrackWidth } from '../useTrackWidth'
import { clamp, clampUnit } from '../util'
import { panWindow, zoomWindow } from '../zoom'
import styles from './ScrubTrack.module.css'

/** Wheel `deltaY` -> zoom `factor`, tuned so a typical mouse-wheel notch (~100) changes span
 *  by roughly 15%. */
const ZOOM_SENSITIVITY = 0.0015

/** Importance units above the LOD threshold over which a freshly-revealed event ramps from
 *  transparent to fully opaque, so events pop in as a fade rather than a hard cut. */
const FADE_BAND = 0.12

/** Half the hit area's own height (`.hitArea` in the CSS module) — where a row-0 checkpoint
 *  pip sits vertically, staggered rows climbing above it. Kept in sync with that height by
 *  hand since CSS custom properties can't drive inline pixel math here. */
const PIP_BASELINE_PX = 24
const PIP_ROW_STEP_PX = 11

interface ScrubTrackProps {
  t: GeoTime
  window: TimeWindow
  scale: TimeScale
  scaleKind: 'symlog' | 'linear'
  events: readonly TimelineEvent[]
  checkpoints: readonly TimelineCheckpoint[]
  onScrub: (t: GeoTime) => void
  onWindowChange: (window: TimeWindow) => void
  /** Double-clicking an event's marker frames its uncertainty band (README §2) instead of
   *  scrubbing to it. */
  onFrameEvent: (event: TimelineEvent) => void
}

export function ScrubTrack({
  t,
  window: visibleWindow,
  scale,
  scaleKind,
  events,
  checkpoints,
  onScrub,
  onWindowChange,
  onFrameEvent,
}: ScrubTrackProps) {
  const [trackRef, trackWidthPx] = useTrackWidth<HTMLDivElement>()

  const uFromClientX = useCallback(
    (clientX: number): number => {
      const el = trackRef.current
      if (!el) return 0
      const rect = el.getBoundingClientRect()
      if (rect.width === 0) return 0
      return clampUnit((clientX - rect.left) / rect.width)
    },
    [trackRef],
  )

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

  const spanYears = visibleWindow[1] - visibleWindow[0]
  const threshold = minImportanceForSpan(spanYears)
  // The fade ramps in from the LOD threshold, but never from above 1 - FADE_BAND: at full
  // zoom-out the threshold reaches 1, which would otherwise fade the importance-1 events —
  // the only ones `visibleEvents` still lets through there — to fully transparent.
  const fadeFloor = Math.min(threshold, 1 - FADE_BAND)
  const shown = visibleEvents(events, visibleWindow, spanYears)
  const playheadU = clampUnit(scale.toUnit(t))

  const pips = useMemo(
    () => layoutCheckpointPips(checkpoints, visibleWindow, scale, trackWidthPx),
    [checkpoints, visibleWindow, scale, trackWidthPx],
  )

  // Plain vertical wheel zooms around the cursor (also how ctrl+wheel / trackpad pinch reach
  // this handler — the browser reports pinch as a wheel event with ctrlKey set, but the
  // deltaY-driven zoom below already does the right thing for it without special-casing).
  // shift+wheel or a wheel that's mostly horizontal (deltaX dominant) pans instead.
  const handleWheel = (e: ReactWheelEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const isPan = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)
    if (isPan) {
      if (trackWidthPx === 0) return
      // Shift turns a plain vertical scroll (deltaY, deltaX === 0) into a pan — reuse deltaY
      // as the pan delta in that case rather than requiring the browser to have already
      // remapped it to deltaX itself (some do, some don't).
      const rawDeltaPx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX
      onWindowChange(panWindow(visibleWindow, rawDeltaPx / trackWidthPx, scaleKind))
      return
    }
    const anchorU = uFromClientX(e.clientX)
    const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY)
    onWindowChange(zoomWindow(visibleWindow, anchorU, factor, scaleKind))
  }

  /** Double-clicking anywhere within a visible event's uncertainty band frames it (README §2).
   *  The most specific (narrowest-band) match wins when bands overlap. */
  const handleDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const u = uFromClientX(e.clientX)
    const clickedT = scale.fromUnit(u)
    const hit = shown
      .filter((ev) => clickedT >= ev.tMin && clickedT <= ev.tMax)
      .reduce<TimelineEvent | null>((best, ev) => (best === null || ev.tMax - ev.tMin < best.tMax - best.tMin ? ev : best), null)
    if (hit) onFrameEvent(hit)
  }

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Scrub timeline"
      aria-valuemin={visibleWindow[0]}
      aria-valuemax={visibleWindow[1]}
      aria-valuenow={t}
      tabIndex={0}
      className={styles.hitArea}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
    >
      <div aria-hidden className={styles.baseline} />

      {shown.map((event) => {
        const uStart = clamp(scale.toUnit(event.tMax), 0, 1)
        const uEnd = clamp(scale.toUnit(event.tMin), 0, 1)
        const opacity = clampUnit((event.importance - fadeFloor) / FADE_BAND)
        return (
          <div
            key={event.id}
            title={event.label}
            className={styles.eventBand}
            style={{
              left: `${uStart * 100}%`,
              width: `${Math.max(uEnd - uStart, 0.002) * 100}%`,
              opacity,
            }}
          />
        )
      })}

      {pips.map((pip) => (
        <button
          key={pip.id}
          type="button"
          className={styles.pip}
          style={{ left: `${pip.u * 100}%`, top: PIP_BASELINE_PX - pip.row * PIP_ROW_STEP_PX }}
          title={`${pip.label} — ${formatGeoTime(pip.t)}`}
          aria-label={`${pip.label}, ${formatGeoTime(pip.t)}`}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onScrub(pip.t)
          }}
        >
          <span aria-hidden className={styles.pipDiamond} />
          <span aria-hidden className={styles.pipPreview}>
            {pip.thumbnailUrl && <img className={styles.pipThumb} src={pip.thumbnailUrl} alt="" />}
            <span className={styles.pipTime}>{formatGeoTime(pip.t)}</span>
            <span className={styles.pipLabel}>{pip.label}</span>
          </span>
        </button>
      ))}

      <div aria-hidden className={styles.playhead} style={{ left: `${playheadU * 100}%` }}>
        <div className={styles.playheadKnob} />
      </div>
      <span aria-live="polite" className={styles.timeLabel} style={{ left: `${playheadU * 100}%` }}>
        {formatGeoTime(t)}
      </span>
    </div>
  )
}
