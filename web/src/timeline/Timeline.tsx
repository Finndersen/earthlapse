'use client'

/**
 * Props contract for the integrator (W12):
 *
 * - `t`, `window`, `scaleKind`, `events`, `playback` are read-only inputs — this component
 *   owns no state of its own beyond ephemeral pointer-drag bookkeeping and the in-flight
 *   scale-toggle / window-transition animations.
 * - `onScrub(t)` fires from dragging the scrub track, jumping to a neighbouring event via the
 *   transport's back/forward buttons, or the ←/→ keyboard shortcuts.
 * - `onWindowChange(window)` fires from wheel-zooming/panning the scrub track or dragging the
 *   minimap bracket — every *immediate*, continuous-gesture window change.
 * - `onScaleKindChange(kind)` fires from the symlog/linear toggle button.
 * - `onPlaybackChange(playback)` fires from the play/pause button, the speed selector, and the
 *   space-bar shortcut.
 * - `onScaleChange(scale)` (optional, W12a) fires whenever this component's own animated
 *   `TimeScale` — the same one driving its scrub track and event lanes — changes, including
 *   mid-animation frames of the symlog/linear toggle. A caller that needs to share the exact
 *   scale the timeline is drawing with (e.g. an expanded `LayerChart` in the chart dock, so
 *   the value under its playhead sits directly above the timeline's own) stores this in its
 *   own state rather than recomputing an independent `useAnimatedScale` instance, which would
 *   drift by a frame and needn't share `window`/`scaleKind` identity. See `useAnimatedScale`'s
 *   doc comment for why this doesn't loop.
 * - `following` (optional, default `false`): whether follow-during-playback is currently
 *   engaged (README §4) — purely a display flag for the subtle indicator in `ZoomControls`.
 *   The caller (Experience.tsx) owns the actual follow logic, next to its playback loop; this
 *   component neither computes nor toggles it.
 *
 * Every *discrete* window change this component originates — the zoom buttons, fit-all,
 * double-clicking an event to frame it, and a minimap click/double-click — goes through its
 * own internal `useWindowTransition` and therefore eases (README §3); wheel, pinch and drags
 * call `onWindowChange` directly and so are immediate, matching the same rule.
 *
 * The caller (holding the single `t` per DESIGN §4) is expected to feed `onScrub` straight
 * into its `t` setter, and to drive `advancePlayhead`/`usePlaybackLoop` from `playback` and
 * `t` itself — this component does not call either.
 */

import { useEffect } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import { EARTH_FORMATION } from '@/types/layer'
import type { GeoTime, Playback, TimeScale, TimelineEvent } from '@/types/layer'

import { AxisTicks } from './components/AxisTicks'
import { Minimap } from './components/Minimap'
import { ScrubTrack } from './components/ScrubTrack'
import { Transport } from './components/Transport'
import { formatGeoTime } from './format'
import { timelineKeyIntent } from './keyboard'
import { nearestNeighbourEvent } from './lod'
import type { TimeWindow } from './scale'
import { useAnimatedScale } from './useAnimatedScale'
import { frameEventWindow, zoomWindow } from './zoom'
import { useWindowTransition } from './windowTransition'
import { ZoomControls } from './components/ZoomControls'

/** Span multiplier per zoom-button press or +/− keypress — halves/doubles the visible span,
 *  a single unambiguous "click" of zoom rather than a continuous rate. */
const BUTTON_ZOOM_FACTOR = 2

export interface TimelineProps {
  t: GeoTime
  window: TimeWindow
  /** `'density'` is out of scope for this package (see index.ts) — the caller must not pass
   *  it here. */
  scaleKind: 'symlog' | 'linear'
  events: readonly TimelineEvent[]
  playback: Playback
  onScrub: (t: GeoTime) => void
  onWindowChange: (window: TimeWindow) => void
  onScaleKindChange: (kind: 'symlog' | 'linear') => void
  onPlaybackChange: (playback: Playback) => void
  onScaleChange?: (scale: TimeScale) => void
  /** Whether follow-during-playback is currently engaged (README §4) — display only. */
  following?: boolean
}

export function Timeline({
  t,
  window: visibleWindow,
  scaleKind,
  events,
  playback,
  onScrub,
  onWindowChange,
  onScaleKindChange,
  onPlaybackChange,
  onScaleChange,
  following = false,
}: TimelineProps) {
  const scale = useAnimatedScale(visibleWindow, scaleKind)

  useEffect(() => {
    onScaleChange?.(scale)
  }, [scale, onScaleChange])

  const animateWindowTo = useWindowTransition({ window: visibleWindow, scaleKind, onWindowChange })

  const zoomAroundPlayhead = (factor: number): void => {
    const anchorU = Math.min(1, Math.max(0, scale.toUnit(t)))
    animateWindowTo(zoomWindow(visibleWindow, anchorU, factor, scaleKind))
  }
  const fitAll = (): void => animateWindowTo([0, EARTH_FORMATION])
  const handleFrameEvent = (event: TimelineEvent): void => animateWindowTo(frameEventWindow(event.tMin, event.tMax))

  const spanYears = visibleWindow[1] - visibleWindow[0]

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const intent = timelineKeyIntent({ key: e.key, target: e.target })
    if (!intent) return
    e.preventDefault()
    switch (intent.type) {
      case 'zoom-in':
        zoomAroundPlayhead(BUTTON_ZOOM_FACTOR)
        return
      case 'zoom-out':
        zoomAroundPlayhead(1 / BUTTON_ZOOM_FACTOR)
        return
      case 'fit-all':
        fitAll()
        return
      case 'toggle-play':
        onPlaybackChange({ ...playback, playing: !playback.playing })
        return
      case 'step': {
        const direction = intent.direction === 'prev' ? 'back' : 'forward'
        const nearest = nearestNeighbourEvent(events, visibleWindow, spanYears, t, direction)
        if (nearest) onScrub((nearest.tMin + nearest.tMax) / 2)
        return
      }
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }} onKeyDown={handleKeyDown}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Transport
          t={t}
          window={visibleWindow}
          events={events}
          playback={playback}
          onScrub={onScrub}
          onPlaybackChange={onPlaybackChange}
        />
        <span aria-live="polite">{formatGeoTime(t)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ZoomControls
            onZoomIn={() => zoomAroundPlayhead(BUTTON_ZOOM_FACTOR)}
            onZoomOut={() => zoomAroundPlayhead(1 / BUTTON_ZOOM_FACTOR)}
            onFitAll={fitAll}
            following={following}
          />
          <button
            type="button"
            aria-pressed={scaleKind === 'linear'}
            onClick={() => onScaleKindChange(scaleKind === 'symlog' ? 'linear' : 'symlog')}
          >
            {scaleKind === 'symlog' ? 'symlog' : 'linear'}
          </button>
        </div>
      </div>
      <ScrubTrack
        t={t}
        window={visibleWindow}
        scale={scale}
        scaleKind={scaleKind}
        events={events}
        onScrub={onScrub}
        onWindowChange={onWindowChange}
        onFrameEvent={handleFrameEvent}
      />
      <AxisTicks window={visibleWindow} scale={scale} />
      <Minimap t={t} window={visibleWindow} onWindowChange={onWindowChange} animateWindowTo={animateWindowTo} />
    </div>
  )
}
