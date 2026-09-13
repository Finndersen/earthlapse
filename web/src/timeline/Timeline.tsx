'use client'

/**
 * Props contract for the integrator (W12):
 *
 * - `t`, `window`, `scaleKind`, `events`, `playback` are read-only inputs — this component
 *   owns no state of its own beyond ephemeral pointer-drag bookkeeping and the in-flight
 *   scale-toggle animation.
 * - `onScrub(t)` fires from dragging the scrub track or jumping to a neighbouring event via
 *   the transport's back/forward buttons.
 * - `onWindowChange(window)` fires from wheel-zooming the scrub track or dragging the
 *   minimap.
 * - `onScaleKindChange(kind)` fires from the symlog/linear toggle button.
 * - `onPlaybackChange(playback)` fires from the play/pause button and the speed selector.
 * - `onScaleChange(scale)` (optional, W12a) fires whenever this component's own animated
 *   `TimeScale` — the same one driving its scrub track and event lanes — changes, including
 *   mid-animation frames of the symlog/linear toggle. A caller that needs to share the exact
 *   scale the timeline is drawing with (e.g. an expanded `LayerChart` in the chart dock, so
 *   the value under its playhead sits directly above the timeline's own) stores this in its
 *   own state rather than recomputing an independent `useAnimatedScale` instance, which would
 *   drift by a frame and needn't share `window`/`scaleKind` identity. See `useAnimatedScale`'s
 *   doc comment for why this doesn't loop.
 *
 * The caller (holding the single `t` per DESIGN §4) is expected to feed `onScrub` straight
 * into its `t` setter, and to drive `advancePlayhead`/`usePlaybackLoop` from `playback` and
 * `t` itself — this component does not call either.
 */

import { useEffect } from 'react'

import type { GeoTime, Playback, TimeScale, TimelineEvent } from '@/types/layer'

import { Minimap } from './components/Minimap'
import { ScrubTrack } from './components/ScrubTrack'
import { Transport } from './components/Transport'
import { formatGeoTime } from './format'
import type { TimeWindow } from './scale'
import { useAnimatedScale } from './useAnimatedScale'

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
}: TimelineProps) {
  const scale = useAnimatedScale(visibleWindow, scaleKind)

  useEffect(() => {
    onScaleChange?.(scale)
  }, [scale, onScaleChange])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
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
        <button
          type="button"
          aria-pressed={scaleKind === 'linear'}
          onClick={() => onScaleKindChange(scaleKind === 'symlog' ? 'linear' : 'symlog')}
        >
          {scaleKind === 'symlog' ? 'symlog' : 'linear'}
        </button>
      </div>
      <ScrubTrack
        t={t}
        window={visibleWindow}
        scale={scale}
        scaleKind={scaleKind}
        events={events}
        onScrub={onScrub}
        onWindowChange={onWindowChange}
      />
      <Minimap window={visibleWindow} onWindowChange={onWindowChange} />
    </div>
  )
}
