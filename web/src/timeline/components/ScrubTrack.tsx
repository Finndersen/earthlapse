'use client'

/** The main scrub track: pointer-drag scrubbing, wheel-to-zoom, event uncertainty bands with
 *  LOD fade, scene checkpoint pips, the playhead, and the fisheye hover readout (ADR-017).
 *  A luminous hairline baseline rather than a filled panel, per the shared visual language —
 *  the hit area (`.hitArea`) stays taller than anything drawn inside it so the track stays easy
 *  to grab. Each pip carries `data-checkpoint-pip`, a stable hook the shell uses to recede
 *  whatever sits where a pip's hover preview rises.
 *
 *  `scale` is the fisheye-distorted track scale (`fisheyeScale`, owned by `Timeline`) — what
 *  is drawn and what pointer x maps through; `baseScale` is the same window undistorted, used
 *  only to convert a *displayed* anchor point back to undistorted `u` before handing it to
 *  something that zooms/pans the underlying window (wheel, double-click) — zooming is always
 *  in undistorted space, the lens is a pointer-time reading of it, not a new space to zoom in.
 *
 *  Wheel handling is a native `addEventListener('wheel', ..., { passive: false })` on the hit
 *  area, not React's `onWheel` — see `handleWheel`'s doc comment for why a plain `onWheel`
 *  cannot reliably `preventDefault` here. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

import type { GeoTime, TimeScale, TimelineEvent } from '@/types/layer'

import { layoutCheckpointPips } from '../checkpointLayout'
import type { TimelineCheckpoint } from '../checkpoints'
import type { FisheyeScale } from '../fisheye'
import { formatGeoTime } from '../format'
import { minImportanceAt } from '../lod'
import type { TimeWindow } from '../scale'
import { findSnapTarget, snapCandidates } from '../snap'
import { useTrackWidth } from '../useTrackWidth'
import { clamp, clampUnit } from '../util'
import { useWheelZoomAccumulator } from '../wheelZoom'
import { panWindow } from '../zoom'
import styles from './ScrubTrack.module.css'

/** Wheel `deltaY` -> zoom `factor`, tuned so a typical mouse-wheel notch (~100) changes span
 *  by roughly 15%. Fed into the eased/accumulated wheel-zoom hook, not applied directly. */
const ZOOM_SENSITIVITY = 0.0015

/** Importance units above the LOD threshold over which a freshly-revealed event ramps from
 *  transparent to fully opaque, so events pop in as a fade rather than a hard cut. */
const FADE_BAND = 0.12

/** Half the hit area's own height (`.hitArea` in the CSS module) — where a row-0 checkpoint
 *  pip sits vertically, staggered rows climbing above it. Kept in sync with that height by
 *  hand since CSS custom properties can't drive inline pixel math here. */
const PIP_BASELINE_PX = 24
const PIP_ROW_STEP_PX = 11

/** Half of `.pipPreview`'s (and the hover readout's) width in the CSS module: content closer
 *  than this to either end of the track anchors to that side instead of centring, so it is
 *  never clipped by the window edge. */
const PREVIEW_HALF_WIDTH_PX = 60

function previewAnchorClass(u: number, trackWidthPx: number): string {
  if (u * trackWidthPx < PREVIEW_HALF_WIDTH_PX) return styles.previewStart ?? ''
  if ((1 - u) * trackWidthPx < PREVIEW_HALF_WIDTH_PX) return styles.previewEnd ?? ''
  return ''
}

interface ScrubTrackProps {
  t: GeoTime
  window: TimeWindow
  scale: FisheyeScale
  baseScale: TimeScale
  scaleKind: 'symlog' | 'linear'
  events: readonly TimelineEvent[]
  checkpoints: readonly TimelineCheckpoint[]
  onScrub: (t: GeoTime) => void
  onWindowChange: (window: TimeWindow) => void
  /** Double-clicking an event's marker frames its uncertainty band (README §2) instead of
   *  scrubbing to it. */
  onFrameEvent: (event: TimelineEvent) => void
  /** Double-clicking the track *away* from any event marker instead zooms x2, eased, around
   *  that point (brief §2). `anchorU` is undistorted — the click position in `baseScale`'s own
   *  0..1 space. */
  onEmptyDoubleClick: (anchorU: number) => void
  /** The pointer is over the track at displayed unit `u` (a `trackWidthPx`-wide track) — feeds
   *  `Timeline`'s fisheye lens (ADR-017). Fired on hover (mouse) and while dragging (any
   *  pointer type), matching the hover-readout visibility rules below. */
  onLensPointer: (u: number, trackWidthPx: number) => void
  /** The pointer has left the track (or a non-mouse drag ended) — let the lens fade back to
   *  rest. */
  onLensRelease: () => void
}

export function ScrubTrack({
  t,
  window: visibleWindow,
  scale,
  baseScale,
  scaleKind,
  events,
  checkpoints,
  onScrub,
  onWindowChange,
  onFrameEvent,
  onEmptyDoubleClick,
  onLensPointer,
  onLensRelease,
}: ScrubTrackProps) {
  const [trackRef, trackWidthPx] = useTrackWidth<HTMLDivElement>()
  const applyWheelZoom = useWheelZoomAccumulator({ window: visibleWindow, scaleKind, onWindowChange })

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

  const spanYears = visibleWindow[1] - visibleWindow[0]

  // Per-event LOD (ADR-017): the importance floor is computed at each event's own midpoint
  // magnification, not a single global threshold — a wider stretch under the lens reveals the
  // detail a narrower span would, exactly where the lens is doing its job. `opacity` is derived
  // alongside `threshold` here (not recomputed at render) since both come from the same
  // per-event magnification lookup.
  const shown = useMemo(() => {
    const [newest, oldest] = visibleWindow
    return events
      .filter((e) => e.tMax >= newest && e.tMin <= oldest)
      .map((event) => {
        const midpoint = (event.tMin + event.tMax) / 2
        const threshold = minImportanceAt(spanYears, scale.magnificationAt(midpoint))
        // The fade ramps in from the LOD threshold, but never from above 1 - FADE_BAND: at
        // full zoom-out the threshold reaches 1, which would otherwise fade the importance-1
        // events — the only ones still let through there — to fully transparent.
        const fadeFloor = Math.min(threshold, 1 - FADE_BAND)
        return { event, threshold, opacity: clampUnit((event.importance - fadeFloor) / FADE_BAND) }
      })
      .filter((s) => s.event.importance >= s.threshold)
  }, [events, visibleWindow, spanYears, scale])

  const candidates = useMemo(
    () => snapCandidates(shown.map((s) => s.event), checkpoints, visibleWindow),
    [shown, checkpoints, visibleWindow],
  )

  const scrubToClientX = useCallback(
    (clientX: number): void => {
      const rawT = scale.fromUnit(uFromClientX(clientX))
      const snap = findSnapTarget(candidates, scale, rawT, trackWidthPx)
      onScrub(snap?.t ?? rawT)
    },
    [onScrub, scale, uFromClientX, candidates, trackWidthPx],
  )

  // Hover readout visibility (ADR-017, brief §3: "while the pointer is over the scrub track
  // (and while drag-scrubbing, incl. touch)"). Mouse gets a true hover; touch/pen have none, so
  // they only show it for the duration of an active pointer-down (tracked via
  // `activePointerTypeRef`, since `pointerleave` does not fire for the pointer-capturing
  // element while a drag is in flight, but *is* the right cue to hide it for a released touch).
  const [hoverU, setHoverU] = useState<number | null>(null)
  const activePointerTypeRef = useRef<string | null>(null)

  const updateHover = (clientX: number): void => {
    const u = uFromClientX(clientX)
    setHoverU(u)
    onLensPointer(u, trackWidthPx)
  }

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    activePointerTypeRef.current = e.pointerType
    e.currentTarget.setPointerCapture(e.pointerId)
    updateHover(e.clientX)
    scrubToClientX(e.clientX)
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    updateHover(e.clientX)
    if (e.buttons === 0) return
    scrubToClientX(e.clientX)
  }

  const handlePointerUp = (): void => {
    if (activePointerTypeRef.current !== 'mouse') {
      setHoverU(null)
      onLensRelease()
    }
    activePointerTypeRef.current = null
  }

  const handlePointerLeave = (): void => {
    // Mid-drag, the capturing element keeps receiving move events even once the pointer has
    // physically left it — don't hide the readout (or release the lens) out from under an
    // active drag.
    if (activePointerTypeRef.current === null) {
      setHoverU(null)
      onLensRelease()
    }
  }

  const playheadU = clampUnit(scale.toUnit(t))

  const pips = useMemo(
    () => layoutCheckpointPips(checkpoints, visibleWindow, scale, trackWidthPx),
    [checkpoints, visibleWindow, scale, trackWidthPx],
  )

  // The readout's last real content, kept across `hoverU` going back to `null` so its fade-out
  // shows that content shrinking away in place rather than drifting: `scale` keeps changing
  // every frame while the lens relaxes after pointer-leave (`useFisheye`'s rAF loop), so once
  // `hoverU` is null the whole result — not just the position it was read at — must freeze,
  // or re-deriving `t`/`label` from the live scale each render would visibly slide the readout
  // during the fade even though its position looks pinned. Also doubles as "has this track ever
  // been hovered".
  const lastHoverInfoRef = useRef<{ u: number; t: GeoTime; label: string | undefined } | null>(null)
  const hoverInfo = useMemo(() => {
    if (hoverU === null) return lastHoverInfoRef.current
    const rawT = scale.fromUnit(hoverU)
    const snap = findSnapTarget(candidates, scale, rawT, trackWidthPx)
    const info = { u: hoverU, t: snap?.t ?? rawT, label: snap?.label }
    lastHoverInfoRef.current = info
    return info
  }, [hoverU, scale, candidates, trackWidthPx])

  // Plain vertical wheel zooms around the cursor, eased and accumulated rather than applied as
  // a hard step per notch (also how ctrl+wheel / trackpad pinch reach this handler — the
  // browser reports pinch as a wheel event with ctrlKey set, but the deltaY-driven zoom below
  // already does the right thing for it without special-casing). shift+wheel or a wheel that's
  // mostly horizontal (deltaX dominant) pans instead — immediately, not eased: a pan gesture's
  // content should move 1:1 with it.
  //
  // A *native* listener, not React's `onWheel`: React attaches wheel (and touchstart/move) at
  // the root as a passive listener for scroll-perf reasons, so `preventDefault` inside a plain
  // `onWheel` handler silently fails with a console warning ("Unable to preventDefault inside
  // passive event listener invocation") and the page scrolls under the track instead of the
  // track consuming the gesture — a QA-reported defect. `{ passive: false }` here is what
  // actually lets `preventDefault` take effect.
  const handleWheel = useCallback(
    (e: WheelEvent): void => {
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
      // The anchor must be undistorted `u`: `zoomWindow` (inside the accumulator) zooms
      // `visibleWindow` itself, which is undistorted — anchoring on the displayed `u` directly
      // would zoom around the wrong point in the underlying window whenever the lens is active.
      const anchorU = baseScale.toUnit(scale.fromUnit(uFromClientX(e.clientX)))
      const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY)
      applyWheelZoom(anchorU, factor)
    },
    [trackWidthPx, onWindowChange, visibleWindow, scaleKind, uFromClientX, applyWheelZoom, baseScale, scale],
  )

  // Kept fresh every render and read from inside the stable listener below, so the effect
  // doesn't need to tear down and re-attach the native listener every time `handleWheel`'s own
  // dependencies change (the same "ref mirrors the latest closure" idiom `usePlaybackLoop` and
  // `useWheelZoomAccumulator` already use elsewhere in this package).
  const handleWheelRef = useRef(handleWheel)
  handleWheelRef.current = handleWheel

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const listener = (e: WheelEvent): void => handleWheelRef.current(e)
    el.addEventListener('wheel', listener, { passive: false })
    return () => el.removeEventListener('wheel', listener)
  }, [trackRef])

  /** Double-clicking anywhere within a visible event's uncertainty band frames it (README §2);
   *  double-clicking elsewhere on the track zooms x2 around that point instead (brief §2),
   *  anchored in undistorted space like the wheel handler above. */
  const handleDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const u = uFromClientX(e.clientX)
    const clickedT = scale.fromUnit(u)
    const hit = shown
      .filter((s) => clickedT >= s.event.tMin && clickedT <= s.event.tMax)
      .reduce<TimelineEvent | null>(
        (best, s) => (best === null || s.event.tMax - s.event.tMin < best.tMax - best.tMin ? s.event : best),
        null,
      )
    if (hit) {
      onFrameEvent(hit)
      return
    }
    onEmptyDoubleClick(baseScale.toUnit(clickedT))
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
      data-hover-active={hoverU !== null}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={handleDoubleClick}
    >
      <div aria-hidden className={styles.baseline} />

      {shown.map(({ event, opacity }) => {
        const uStart = clamp(scale.toUnit(event.tMax), 0, 1)
        const uEnd = clamp(scale.toUnit(event.tMin), 0, 1)
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
          data-checkpoint-pip
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
          <span aria-hidden className={`${styles.pipPreview} ${previewAnchorClass(pip.u, trackWidthPx)}`}>
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

      {hoverInfo && (
        <div
          aria-hidden
          className={`${styles.hoverReadout} ${previewAnchorClass(hoverInfo.u, trackWidthPx)}`}
          data-visible={hoverU !== null}
          style={{ left: `${hoverInfo.u * 100}%` }}
        >
          {hoverInfo.label && <span className={styles.snapLabel}>{hoverInfo.label}</span>}
          <span className={styles.time}>{formatGeoTime(hoverInfo.t)}</span>
        </div>
      )}
    </div>
  )
}
