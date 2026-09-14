'use client'

/**
 * Props contract for the integrator (W12/W13):
 *
 * - `t`, `window`, `scaleKind`, `events`, `checkpoints`, `playback` are read-only inputs —
 *   this component owns no state of its own beyond ephemeral pointer-drag bookkeeping and the
 *   in-flight scale-toggle / window-transition animations.
 * - `onScrub(t)` fires from dragging the scrub track, clicking a checkpoint pip, jumping to a
 *   neighbouring event or checkpoint via the transport's back/forward buttons, or the ←/→
 *   keyboard shortcuts.
 * - `onWindowChange(window)` fires from wheel-zooming/panning the scrub track or dragging the
 *   minimap bracket — every *immediate*, continuous-gesture window change.
 * - `onScaleKindChange(kind)` fires from the symlog/linear toggle button.
 * - `onPlaybackChange(playback)` fires from the play/pause button, the speed selector, the
 *   scenes/steady mode toggle (ADR-016), and the space-bar shortcut.
 * - `scale` is the animated, undistorted `TimeScale` over `window` (`useAnimatedScale(window,
 *   scaleKind)`), owned by the caller rather than computed here, so anything else drawn against
 *   the same axis (the expanded `LayerChart` in the chart dock, deliberately left undistorted —
 *   ADR-017) shares the exact object this component's zoom buttons, keyboard shortcuts and
 *   window transitions use. It is an input only, never reported back up: an effect-driven
 *   "scale changed" callback made every minimap drag frame schedule a second render from inside
 *   an effect, which a fast pointer starved into React's "Maximum update depth exceeded".
 * - The scrub track and ruler are drawn against a second, fisheye-distorted `trackScale`
 *   instead (ADR-017): while the pointer hovers the track, a lens stretches the region around
 *   it so nearby events/pips/ticks spread apart and the rest compresses toward both ends —
 *   answering the old hover loupe's actual problem (a *linear* window of `span / 12` on a
 *   *symlog* track showed a ~380 Myr span at full zoom-out) by enlarging the track itself
 *   instead of floating a separate, differently-scaled overlay above it. `trackScale` is owned
 *   here (`useFisheye` + `fisheyeScale(scale, fisheye.lens, fisheye.trackWidthPx)`) and passed
 *   to `<ScrubTrack>` as `scale` and to `<AxisTicks>`, so the ruler stretches in lockstep with
 *   the track; `<ScrubTrack>` also gets the undistorted `scale` back as `baseScale`, since
 *   zooming/panning the underlying window always happens in undistorted space. Every *discrete*
 *   window change below (zoom buttons, fit-all, event framing) anchors on `scale`, never
 *   `trackScale` — the lens is a pointer-time reading of the window, not a new space to zoom in.
 * - `following` (optional, default `false`): whether follow-during-playback is currently
 *   engaged (README §4) — purely a display flag for the subtle indicator in `ZoomControls`.
 *   The caller (Experience.tsx) owns the actual follow logic, next to its playback loop; this
 *   component neither computes nor toggles it.
 *
 * Every *discrete* window change this component originates — the zoom buttons, fit-all,
 * double-clicking an event to frame it, and a minimap click/double-click — goes through its
 * own internal `useWindowTransition` and therefore eases (README §3). Wheel, pinch and drags
 * call `onWindowChange` directly and so are immediate, matching the same rule.
 *
 * The caller (holding the single `t` per DESIGN §4) is expected to feed `onScrub` straight
 * into its `t` setter, and to drive `advancePlayhead`/`usePlaybackLoop` from `playback` and
 * `t` itself — this component does not call either.
 *
 * Chrome-less by design (W13, SHARED VISUAL LANGUAGE): no panel background here or in any
 * child — this floats over whatever darkened surround the shell provides. The current-time
 * readout lives on the scrub track, riding above the playhead, rather than as a centred span
 * in this row — the shell shows the large era/time title elsewhere (`eraNameForTime`,
 * exported from `eras.ts`, is what it reads that from). The transport, minimap and zoom
 * controls share one row *beneath* the track, so the space above it belongs only to things
 * that ride the track (the playhead readout, checkpoint previews, a docked chart) and never
 * collides with a button.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import { EARTH_FORMATION } from '@/types/layer'
import type { GeoTime, Playback, TimeScale, TimelineEvent } from '@/types/layer'

import { nearestStepTarget, type TimelineCheckpoint } from './checkpoints'
import { AxisTicks } from './components/AxisTicks'
import { Minimap } from './components/Minimap'
import { ScrubTrack } from './components/ScrubTrack'
import { TimelineHint } from './components/TimelineHint'
import { Transport } from './components/Transport'
import { ZoomControls } from './components/ZoomControls'
import { fisheyeScale } from './fisheye'
import { readHintDismissed, writeHintDismissed } from './hint'
import { timelineKeyIntent } from './keyboard'
import type { TimeWindow } from './scale'
import styles from './Timeline.module.css'
import { useFisheye } from './useFisheye'
import { frameEventWindow, zoomWindow } from './zoom'
import { useWindowTransition } from './windowTransition'

/** Span multiplier per zoom-button press or +/− keypress — halves/doubles the visible span,
 *  a single unambiguous "click" of zoom rather than a continuous rate. Also the factor for
 *  double-clicking the track away from any event marker (brief §2: "zoom x2 around that
 *  point"). */
const BUTTON_ZOOM_FACTOR = 2

export interface TimelineProps {
  t: GeoTime
  window: TimeWindow
  /** `'density'` is out of scope for this package (see index.ts) — the caller must not pass
   *  it here. */
  scaleKind: 'symlog' | 'linear'
  /** The animated scale over `window` — see the `scale` bullet in the doc comment above. */
  scale: TimeScale
  events: readonly TimelineEvent[]
  /** The generated stills, plotted as scene checkpoint pips (W13) distinct from data-driven
   *  `events` — every one inside the visible window is always drawn, with no importance LOD,
   *  since these are the images the viewer sees rather than annotations on the axis. */
  checkpoints?: readonly TimelineCheckpoint[]
  playback: Playback
  onScrub: (t: GeoTime) => void
  onWindowChange: (window: TimeWindow) => void
  onScaleKindChange: (kind: 'symlog' | 'linear') => void
  onPlaybackChange: (playback: Playback) => void
  /** Whether follow-during-playback is currently engaged (README §4) — display only. */
  following?: boolean
  /** Instantaneous, smoothed years-per-second `t` is advancing at (ADR-016's prototype rate
   *  readout) — passed straight through to `Transport`. `null`/omitted shows nothing. */
  ratePerSecond?: number | null
}

export function Timeline({
  t,
  window: visibleWindow,
  scaleKind,
  scale,
  events,
  checkpoints = [],
  playback,
  onScrub,
  onWindowChange,
  onScaleKindChange,
  onPlaybackChange,
  following = false,
  ratePerSecond = null,
}: TimelineProps) {
  // The first-use hint (brief §2): shown until either dismissed directly or the first
  // successful zoom/pan. Starts hidden and only flips on in an effect (not read synchronously
  // from sessionStorage during render) so a server-rendered first paint never disagrees with
  // the client's own storage — avoiding a hydration mismatch.
  const [hintVisible, setHintVisible] = useState(false)
  useEffect(() => {
    if (!readHintDismissed()) setHintVisible(true)
  }, [])
  const hintDismissedRef = useRef(false)
  const dismissHint = useCallback((): void => {
    setHintVisible(false)
    if (hintDismissedRef.current) return
    hintDismissedRef.current = true
    writeHintDismissed()
  }, [])

  // The fisheye lens (ADR-017): owned here, not in `ScrubTrack`, so `AxisTicks` can be
  // distorted by the exact same lens the track is. `trackScale` is memoised on the lens/track
  // width actually changing, not recomputed from scratch on every unrelated re-render (a
  // playhead tick while the pointer sits still over the track).
  const fisheye = useFisheye()
  const trackScale = useMemo(
    () => fisheyeScale(scale, fisheye.lens, fisheye.trackWidthPx),
    [scale, fisheye.lens, fisheye.trackWidthPx],
  )

  // Every window change reaching this — wheel/pinch zoom, wheel/drag pan, a zoom/fit button, an
  // event frame, a minimap or ruler drag — counts as the "successful zoom/pan" that dismisses
  // the hint. Plain scrubbing (`onScrub`) deliberately does not: it's listed as its own bullet
  // in the hint text, not what the hint is gating.
  const handleWindowChange = useCallback(
    (w: TimeWindow): void => {
      dismissHint()
      onWindowChange(w)
    },
    [dismissHint, onWindowChange],
  )

  const animateWindowTo = useWindowTransition({ window: visibleWindow, scaleKind, onWindowChange: handleWindowChange })

  const zoomAroundPlayhead = (factor: number): void => {
    const anchorU = Math.min(1, Math.max(0, scale.toUnit(t)))
    animateWindowTo(zoomWindow(visibleWindow, anchorU, factor, scaleKind))
  }
  const fitAll = (): void => animateWindowTo([0, EARTH_FORMATION])
  const handleFrameEvent = (event: TimelineEvent): void => animateWindowTo(frameEventWindow(event.tMin, event.tMax))
  /** Double-clicking the track away from any event marker zooms x2 around that point, eased
   *  (brief §2) — `anchorU` comes from `ScrubTrack` in its own 0..1 space, which is exactly
   *  `zoomWindow`'s `anchorU` contract. */
  const handleEmptyDoubleClick = (anchorU: number): void => animateWindowTo(zoomWindow(visibleWindow, anchorU, BUTTON_ZOOM_FACTOR, scaleKind))

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
        const target = nearestStepTarget(events, checkpoints, visibleWindow, spanYears, t, direction)
        if (target !== undefined) onScrub(target)
        return
      }
    }
  }

  return (
    <div className={styles.timeline} onKeyDown={handleKeyDown}>
      <ScrubTrack
        t={t}
        window={visibleWindow}
        scale={trackScale}
        baseScale={scale}
        scaleKind={scaleKind}
        events={events}
        checkpoints={checkpoints}
        onScrub={onScrub}
        onWindowChange={handleWindowChange}
        onFrameEvent={handleFrameEvent}
        onEmptyDoubleClick={handleEmptyDoubleClick}
        onLensPointer={fisheye.pointTo}
        onLensRelease={fisheye.release}
      />
      <AxisTicks window={visibleWindow} scale={trackScale} scaleKind={scaleKind} onWindowChange={handleWindowChange} />
      {hintVisible && (
        <div className={styles.hintRow}>
          <TimelineHint onDismiss={dismissHint} />
        </div>
      )}
      <div className={styles.controlsRow}>
        <Transport
          t={t}
          window={visibleWindow}
          events={events}
          checkpoints={checkpoints}
          playback={playback}
          onScrub={onScrub}
          onPlaybackChange={onPlaybackChange}
          ratePerSecond={ratePerSecond}
        />
        <div className={styles.minimap}>
          <Minimap t={t} window={visibleWindow} checkpoints={checkpoints} onWindowChange={handleWindowChange} animateWindowTo={animateWindowTo} />
        </div>
        <div className={styles.rightControls}>
          <ZoomControls
            onZoomIn={() => zoomAroundPlayhead(BUTTON_ZOOM_FACTOR)}
            onZoomOut={() => zoomAroundPlayhead(1 / BUTTON_ZOOM_FACTOR)}
            onFitAll={fitAll}
            following={following}
          />
          <button
            type="button"
            className={styles.scaleToggle}
            aria-pressed={scaleKind === 'linear'}
            onClick={() => onScaleKindChange(scaleKind === 'symlog' ? 'linear' : 'symlog')}
          >
            {scaleKind === 'symlog' ? 'symlog' : 'linear'}
          </button>
        </div>
      </div>
    </div>
  )
}
