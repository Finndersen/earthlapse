'use client'

/**
 * The overview minimap (README §1): a SYMLOG strip of the full 4.6 Gyr domain — "same warp as
 * the main track at full zoom-out" — so a window anywhere in the last ~10 Myr still occupies a
 * visible fraction of it, unlike the old linear minimap this replaces. Always symlog,
 * regardless of the main track's own symlog/linear toggle (`MINIMAP_FULL_DOMAIN`'s scale in
 * `minimapLayout.ts` is fixed).
 *
 * Muted era bands sit behind it for orientation (`eras.ts`). Beneath the symlog strip, a
 * hairline LINEAR strip shows the window's true proportional extent plus a "% of Earth's
 * history" readout — the DESIGN §3 honesty about the warp, kept without making linear the
 * primary navigator.
 *
 * Interactions: drag the bracket body to pan, drag its edges to resize (zoom); click elsewhere
 * on the track to recentre (eased via `animateWindowTo`); double-click anywhere to fit the
 * full domain (also eased). Dragging is immediate, matching the "wheel and pinch stay
 * immediate" rule for anything that is itself a continuous gesture.
 */

import { useCallback, useRef } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

import { EARTH_FORMATION, type GeoTime } from '@/types/layer'

import { ERA_BANDS } from '../eras'
import { formatTimeRange } from '../format'
import { minimapBracket, MINIMAP_FULL_DOMAIN, MIN_BRACKET_PX } from '../minimapLayout'
import { createLinearScale, createSymlogScale, type TimeWindow } from '../scale'
import { useTrackWidth } from '../useTrackWidth'
import { clampWindowToDomain } from '../util'
import { MIN_SPAN_YEARS } from '../zoom'

/** How close, in px, a pointer must land to a bracket edge to grab it for resizing rather than
 *  the bracket body (for panning) or the track (for recentring). */
const EDGE_HANDLE_PX = 7

/** Module-scope, not per-render: `MINIMAP_FULL_DOMAIN` never changes, so recomputing these on
 *  every render would just be a wasted allocation on every frame `t` advances during playback
 *  (Minimap re-renders on every such frame, following or not). Same reasoning as
 *  `FULL_DOMAIN_SCALE` in Experience.tsx. */
const MINIMAP_SYMLOG_SCALE = createSymlogScale(MINIMAP_FULL_DOMAIN)
const MINIMAP_LINEAR_SCALE = createLinearScale(MINIMAP_FULL_DOMAIN)

type DragMode = 'pan' | 'resize-left' | 'resize-right'

interface DragState {
  mode: DragMode
  pointerId: number
  startT: GeoTime
  startWindow: TimeWindow
}

interface MinimapProps {
  t: GeoTime
  window: TimeWindow
  onWindowChange: (window: TimeWindow) => void
  animateWindowTo: (window: TimeWindow) => void
}

function formatHistoryFraction(fraction: number): string {
  const pct = fraction * 100
  if (pct >= 1) return `${pct.toFixed(1)}%`
  if (pct >= 0.01) return `${pct.toFixed(2)}%`
  if (pct === 0) return '0%'
  return `${pct.toExponential(1)}%`
}

export function Minimap({ t, window: visibleWindow, onWindowChange, animateWindowTo }: MinimapProps) {
  // A tracked (re-render-triggering) width, not just a ref read during render: the bracket's
  // MIN_BRACKET_PX floor needs a real pixel width, and a plain `trackRef.current
  // ?.getBoundingClientRect()` read during render is always 0 on first paint (the ref isn't
  // attached to the DOM yet) with nothing to trigger a re-render once it is — the bracket
  // would render zero-width until some unrelated prop change happened to re-render this
  // component.
  const [trackRef, trackWidthPx] = useTrackWidth<HTMLDivElement>()

  const dragRef = useRef<DragState | null>(null)
  const didDragRef = useRef(false)

  const bracket = minimapBracket(visibleWindow, trackWidthPx)
  const playheadU = MINIMAP_SYMLOG_SCALE.toUnit(t)

  const pixelToT = useCallback((clientX: number): GeoTime => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width === 0) return 0
    const u = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return MINIMAP_SYMLOG_SCALE.fromUnit(u)
  }, [])

  const classifyZone = useCallback(
    (clientX: number): DragMode | 'outside' => {
      const el = trackRef.current
      if (!el) return 'outside'
      const rect = el.getBoundingClientRect()
      const px = clientX - rect.left
      const { leftPx, widthPx } = minimapBracket(visibleWindow, rect.width)
      if (Math.abs(px - leftPx) <= EDGE_HANDLE_PX) return 'resize-left'
      if (Math.abs(px - (leftPx + widthPx)) <= EDGE_HANDLE_PX) return 'resize-right'
      if (px >= leftPx && px <= leftPx + widthPx) return 'pan'
      return 'outside'
    },
    [visibleWindow],
  )

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    didDragRef.current = false
    const zone = classifyZone(e.clientX)
    if (zone === 'outside') return // a plain click on the track recentres — see handleClick
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { mode: zone, pointerId: e.pointerId, startT: pixelToT(e.clientX), startWindow: visibleWindow }
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    didDragRef.current = true
    const currentT = pixelToT(e.clientX)
    const [startNewest, startOldest] = drag.startWindow

    if (drag.mode === 'pan') {
      // `pixelToT` is monotonically *decreasing* in clientX (screen-right is smaller t, per
      // the package orientation — see index.ts), so a rightward drag (larger clientX) yields a
      // negative `deltaT`. Adding it (not subtracting) is what makes the bracket track the
      // cursor: dragging right must decrease both bounds (pan toward the present).
      const deltaT = currentT - drag.startT
      const [newest, oldest] = clampWindowToDomain(startNewest + deltaT, startOldest + deltaT, EARTH_FORMATION)
      onWindowChange([newest, oldest])
      return
    }
    if (drag.mode === 'resize-left') {
      const newOldest = Math.min(Math.max(currentT, startNewest + MIN_SPAN_YEARS), EARTH_FORMATION)
      onWindowChange([startNewest, newOldest])
      return
    }
    const newNewest = Math.max(Math.min(currentT, startOldest - MIN_SPAN_YEARS), 0)
    onWindowChange([newNewest, startOldest])
  }

  const handlePointerUp = (): void => {
    dragRef.current = null
  }

  const handleClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (e.detail > 1) return // the second click of a dblclick — handleDoubleClick owns it
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    if (classifyZone(e.clientX) !== 'outside') return
    const centreT = pixelToT(e.clientX)
    const span = visibleWindow[1] - visibleWindow[0]
    const [newest, oldest] = clampWindowToDomain(centreT - span / 2, centreT + span / 2, EARTH_FORMATION)
    animateWindowTo([newest, oldest])
  }

  const handleDoubleClick = (): void => {
    animateWindowTo(MINIMAP_FULL_DOMAIN)
  }

  const linearStartU = MINIMAP_LINEAR_SCALE.toUnit(visibleWindow[1])
  const linearEndU = MINIMAP_LINEAR_SCALE.toUnit(visibleWindow[0])
  const historyFraction = (visibleWindow[1] - visibleWindow[0]) / EARTH_FORMATION

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, width: '100%' }}>
      <div
        ref={trackRef}
        role="slider"
        aria-label="Overview: drag to pan, drag an edge to zoom"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={(bracket.leftPx + bracket.widthPx / 2) / Math.max(1, trackWidthPx)}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        style={{
          position: 'relative',
          height: 20,
          cursor: 'pointer',
          touchAction: 'none',
        }}
      >
        {/* Clipping lives on this inner wrapper, not the interactive track itself — the
            bracket label below sits above the strip and must not be cut off by it. */}
        <div aria-hidden style={{ position: 'absolute', inset: 0, borderRadius: 3, overflow: 'hidden', background: 'rgba(231,226,214,0.05)' }}>
          {ERA_BANDS.map((band) => {
            const left = MINIMAP_SYMLOG_SCALE.toUnit(band.window[1])
            const right = MINIMAP_SYMLOG_SCALE.toUnit(band.window[0])
            return (
              <div
                key={band.id}
                title={band.name}
                style={{
                  position: 'absolute',
                  left: `${left * 100}%`,
                  width: `${Math.max(right - left, 0) * 100}%`,
                  top: 0,
                  bottom: 0,
                  background: ERA_BAND_TINT[band.id],
                  borderRight: '1px solid rgba(231,226,214,0.08)',
                }}
              />
            )
          })}

          <div
            style={{
              position: 'absolute',
              left: playheadU * 100 + '%',
              top: 2,
              bottom: 2,
              width: 1,
              marginLeft: -0.5,
              background: 'rgba(231,226,214,0.85)',
            }}
          />

          <div
            style={{
              position: 'absolute',
              left: `${bracket.leftPx}px`,
              width: `${Math.max(bracket.widthPx, MIN_BRACKET_PX)}px`,
              top: 0,
              bottom: 0,
              background: 'rgba(231,226,214,0.18)',
              border: '1px solid rgba(231,226,214,0.55)',
              borderRadius: 2,
              boxSizing: 'border-box',
              cursor: 'grab',
            }}
          />
        </div>

        <div
          aria-hidden
          style={{
            position: 'absolute',
            left: `${bracket.leftPx + bracket.widthPx / 2}px`,
            top: -15,
            transform: 'translateX(-50%)',
            fontSize: 10,
            whiteSpace: 'nowrap',
            color: 'rgba(231,226,214,0.75)',
            pointerEvents: 'none',
          }}
        >
          {formatTimeRange(visibleWindow)}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          aria-hidden
          style={{ position: 'relative', height: 3, flex: 1, borderRadius: 1.5, background: 'rgba(231,226,214,0.06)' }}
        >
          <div
            style={{
              position: 'absolute',
              left: `${linearStartU * 100}%`,
              width: `${Math.max(linearEndU - linearStartU, 0.0015) * 100}%`,
              top: 0,
              bottom: 0,
              borderRadius: 1.5,
              background: 'rgba(217,154,78,0.65)',
            }}
          />
        </div>
        <span aria-hidden style={{ fontSize: 9.5, color: 'rgba(231,226,214,0.35)', whiteSpace: 'nowrap' }}>
          {formatHistoryFraction(historyFraction)} of Earth&rsquo;s history
        </span>
      </div>
    </div>
  )
}

/** A single warm-neutral ramp rather than one hue per era: Precambrian bands tint the same
 *  off-white as the rest of the chrome, brightening slightly toward the present; the
 *  Phanerozoic bands shift into the app's existing amber accent (`#d99a4e`, already used for
 *  the present-facing "stub data" badge elsewhere in the shell). The one hue change lands
 *  exactly on the Cambrian boundary — the timeline visibly "warms up" the moment complex life
 *  begins, rather than an arbitrary rainbow per era. */
const ERA_BAND_TINT: Record<string, string> = {
  hadean: 'rgba(231,226,214,0.035)',
  archean: 'rgba(231,226,214,0.06)',
  proterozoic: 'rgba(231,226,214,0.09)',
  paleozoic: 'rgba(217,154,78,0.07)',
  mesozoic: 'rgba(217,154,78,0.11)',
  cenozoic: 'rgba(217,154,78,0.16)',
}
