'use client'

/** The main scrub track: pointer-drag scrubbing, wheel-to-zoom, event uncertainty bands with
 *  LOD fade, scene checkpoint pips, the playhead, and the hover loupe. A luminous hairline
 *  baseline rather than a filled panel, per the shared visual language — the hit area
 *  (`.hitArea`) stays taller than anything drawn inside it so the track stays easy to grab.
 *  Each pip carries `data-checkpoint-pip`, a stable hook the shell uses to recede whatever sits
 *  where a pip's hover preview rises.
 *
 *  Wheel handling is a native `addEventListener('wheel', ..., { passive: false })` on the hit
 *  area, not React's `onWheel` — see `handleWheel`'s doc comment for why a plain `onWheel`
 *  cannot reliably `preventDefault` here. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

import type { GeoTime, TimeScale, TimelineEvent } from '@/types/layer'

import { layoutCheckpointPips } from '../checkpointLayout'
import type { TimelineCheckpoint } from '../checkpoints'
import { formatGeoTime } from '../format'
import { minImportanceForSpan, visibleEvents } from '../lod'
import { findLoupeSnapTarget, loupeCandidates, loupePosition, loupeScale, loupeWindow, LOUPE_WIDTH_PX } from '../loupe'
import type { TimeWindow } from '../scale'
import { useTrackWidth } from '../useTrackWidth'
import { clamp, clampUnit } from '../util'
import { useWheelZoomAccumulator } from '../wheelZoom'
import { panWindow } from '../zoom'
import { Loupe } from './Loupe'
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

/** Half of `.pipPreview`'s width in the CSS module: a pip closer than this to either end of
 *  the track anchors its preview to that side instead of centring it, so it is never clipped
 *  by the window edge. */
const PREVIEW_HALF_WIDTH_PX = 60

function previewAnchorClass(u: number, trackWidthPx: number): string {
  if (u * trackWidthPx < PREVIEW_HALF_WIDTH_PX) return styles.previewStart ?? ''
  if ((1 - u) * trackWidthPx < PREVIEW_HALF_WIDTH_PX) return styles.previewEnd ?? ''
  return ''
}

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
  /** Double-clicking the track *away* from any event marker instead zooms x2, eased, around
   *  that point (brief §2). `anchorU` is the click position in the track's own 0..1 space. */
  onEmptyDoubleClick: (anchorU: number) => void
}

/** Viewport size for clamping the loupe, with an SSR/non-browser fallback (this component is
 *  client-only, but a fallback keeps `loupePosition` total rather than reaching for a global
 *  that may not exist during, e.g., a test render before any pointer event has fired). */
function viewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1440, height: 900 }
  return { width: window.innerWidth, height: window.innerHeight }
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
  onEmptyDoubleClick,
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

  /** The loupe's snap target (if any) for a raw pointer time — brief §3: "make a click scrub
   *  exactly to it (instead of the raw pointer time)". Shared by the actual scrub (below) and
   *  the loupe's own render (`hoverInfo`) so both agree on exactly the same candidate. */
  const snapTargetFor = useCallback(
    (rawT: GeoTime) => {
      const win = loupeWindow(visibleWindow, rawT)
      const candidates = loupeCandidates(events, checkpoints, win)
      return findLoupeSnapTarget(candidates, loupeScale(win), rawT, LOUPE_WIDTH_PX)
    },
    [visibleWindow, events, checkpoints],
  )

  const scrubToClientX = useCallback(
    (clientX: number): void => {
      const rawT = scale.fromUnit(uFromClientX(clientX))
      onScrub(snapTargetFor(rawT)?.t ?? rawT)
    },
    [onScrub, scale, uFromClientX, snapTargetFor],
  )

  // Hover loupe visibility (brief §3: "while the pointer is over the scrub track (and while
  // drag-scrubbing, incl. touch)"). Mouse gets a true hover; touch/pen have none, so they only
  // show the loupe for the duration of an active pointer-down (tracked via
  // `activePointerTypeRef`, since `pointerleave` does not fire for the pointer-capturing
  // element while a drag is in flight, but *is* the right cue to hide it for a released touch).
  const [hover, setHover] = useState<{ clientX: number; clientY: number } | null>(null)
  const activePointerTypeRef = useRef<string | null>(null)
  // The loupe's last real position, kept across `hover` going back to `null` so a fade-out
  // (brief: "fade in/out 120ms") shows its last real content shrinking away rather than
  // snapping its content to the playhead the instant the pointer leaves. Also doubles as "has
  // this track ever been hovered" — the loupe isn't mounted at all until it has, so a
  // non-interactive render (tests, first paint) never carries hidden-but-present loupe markup.
  const lastHoverRef = useRef<{ clientX: number; clientY: number } | null>(null)

  const updateHover = (point: { clientX: number; clientY: number }): void => {
    lastHoverRef.current = point
    setHover(point)
  }

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    activePointerTypeRef.current = e.pointerType
    e.currentTarget.setPointerCapture(e.pointerId)
    updateHover({ clientX: e.clientX, clientY: e.clientY })
    scrubToClientX(e.clientX)
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    updateHover({ clientX: e.clientX, clientY: e.clientY })
    if (e.buttons === 0) return
    scrubToClientX(e.clientX)
  }

  const handlePointerUp = (): void => {
    if (activePointerTypeRef.current !== 'mouse') setHover(null)
    activePointerTypeRef.current = null
  }

  const handlePointerLeave = (): void => {
    // Mid-drag, the capturing element keeps receiving move events even once the pointer has
    // physically left it — don't hide the loupe out from under an active drag.
    if (activePointerTypeRef.current === null) setHover(null)
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

  // Computed from `lastHoverRef` (not `hover` directly) so the loupe's *content* freezes on
  // its last real position during a fade-out rather than jumping to the playhead the instant
  // `hover` clears — `visible` below is what actually gates the fade.
  const displayHover = hover ?? lastHoverRef.current
  const hoverInfo = useMemo(() => {
    if (!displayHover) return null
    const rawT = scale.fromUnit(uFromClientX(displayHover.clientX))
    const win = loupeWindow(visibleWindow, rawT)
    const candidates = loupeCandidates(events, checkpoints, win)
    const snap = findLoupeSnapTarget(candidates, loupeScale(win), rawT, LOUPE_WIDTH_PX)
    const viewport = viewportSize()
    const position = loupePosition(displayHover.clientX, displayHover.clientY, viewport.width, viewport.height)
    return { rawT, win, candidates, snap, position }
  }, [displayHover, scale, uFromClientX, visibleWindow, events, checkpoints])

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
      const anchorU = uFromClientX(e.clientX)
      const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY)
      applyWheelZoom(anchorU, factor)
    },
    [trackWidthPx, onWindowChange, visibleWindow, scaleKind, uFromClientX, applyWheelZoom],
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
   *  double-clicking elsewhere on the track zooms x2 around that point instead (brief §2). */
  const handleDoubleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const u = uFromClientX(e.clientX)
    const clickedT = scale.fromUnit(u)
    const hit = shown
      .filter((ev) => clickedT >= ev.tMin && clickedT <= ev.tMax)
      .reduce<TimelineEvent | null>((best, ev) => (best === null || ev.tMax - ev.tMin < best.tMax - best.tMin ? ev : best), null)
    if (hit) {
      onFrameEvent(hit)
      return
    }
    onEmptyDoubleClick(u)
  }

  return (
    <>
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
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
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
      </div>

      {hoverInfo && (
        <Loupe
          visible={hover !== null}
          position={hoverInfo.position}
          window={hoverInfo.win}
          cursorT={hoverInfo.rawT}
          candidates={hoverInfo.candidates}
          snapTarget={hoverInfo.snap}
        />
      )}
    </>
  )
}
