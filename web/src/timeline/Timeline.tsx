'use client'

/**
 * Props contract for the integrator (W12/W13):
 *
 * - `t`, `scaleKind`, `events`, `checkpoints`, `playback` are read-only inputs — this component
 *   owns no state of its own beyond ephemeral pointer-drag bookkeeping, the fisheye lens
 *   (`useFisheye`) and the in-flight scale-toggle animation.
 * - The visible window is always the **full domain**, `[0, EARTH_FORMATION]` — there is no
 *   zoom or pan (removed; see DESIGN §3's v1 note and the density-adaptive fisheye lens below,
 *   which is how a viewer now resolves events sitting close together in time instead). `onScrub`
 *   is therefore the only way `t` changes from inside this component.
 * - `onScrub(t)` fires from dragging the scrub track, clicking a checkpoint pip, jumping to a
 *   neighbouring event or checkpoint via the transport's back/forward buttons, or the ←/→
 *   keyboard shortcuts.
 * - `onScaleKindChange(kind)` fires from the symlog/linear toggle button.
 * - `onPlaybackChange(playback)` fires from the play/pause button, the speed selector, the
 *   scenes/steady mode toggle (ADR-016), and the space-bar shortcut.
 * - `onOpenCluster(members)` fires when a checkpoint cluster marker (ADR-019) is clicked or
 *   tapped — `ScrubTrack` itself opens an in-track member-list popover (ADR-021) on the same
 *   click, so this is only a notification for a caller that wants to know (e.g. analytics); it
 *   is not required to build any UI in response.
 * - `scale` is the animated, undistorted `TimeScale` over the full domain
 *   (`useAnimatedScale([0, EARTH_FORMATION], scaleKind)`), owned by the caller rather than
 *   computed here, so anything else drawn against the same axis (the expanded `LayerChart` in
 *   the chart dock, deliberately left undistorted — ADR-017) shares the exact object this
 *   component's keyboard shortcuts use.
 * - The scrub track and ruler are drawn against a second, fisheye-distorted `trackScale`
 *   instead (ADR-017): while the pointer hovers the track, a lens stretches the region around
 *   it so nearby events/pips/ticks spread apart and the rest compresses toward both ends — this
 *   is how a viewer resolves events or scenes sitting arbitrarily close together in time (down
 *   to individually clickable) without any zoom control. `trackScale` is owned here
 *   (`useFisheye` + `fisheyeScale(scale, fisheye.lens, fisheye.trackWidthPx, markers)`) and
 *   passed to `<ScrubTrack>` and `<AxisTicks>` as `scale`, so the ruler stretches in lockstep
 *   with the track. `markers` (ADR-021) is every checkpoint's `t` and every event's `tMin`/
 *   `tMax`, in undistorted `scale.toUnit` units — built here, once per `checkpoints`/`events`/
 *   `scale` change, so the lens' density-adaptive gap insertion (`fisheye.ts`) knows about every
 *   position on the track that might need room opened up around it, not just the plain bump
 *   around the pointer.
 *
 * The caller (holding the single `t` per DESIGN §4) is expected to feed `onScrub` straight
 * into its `t` setter, and to drive `advancePlayhead`/`usePlaybackLoop` from `playback` and
 * `t` itself — this component does not call either.
 *
 * Chrome-less by design (W13, SHARED VISUAL LANGUAGE): no panel background here or in any
 * child — this floats over whatever darkened surround the shell provides. The current-time
 * readout lives on the scrub track, riding above the playhead, rather than as a centred span
 * in this row — the shell shows the large era/time title elsewhere (`eraNameForTime`,
 * exported from `eras.ts`, is what it reads that from). The transport and the scale toggle
 * share one row *beneath* the track, so the space above it belongs only to things that ride
 * the track (the playhead readout, checkpoint previews, a docked chart) and never collides
 * with a button.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

import { EARTH_FORMATION } from '@/types/layer'
import type { GeoTime, Playback, TimeScale, TimelineEvent } from '@/types/layer'

import { nearestStepTarget, type TimelineCheckpoint } from './checkpoints'
import { AxisTicks } from './components/AxisTicks'
import { ScrubTrack } from './components/ScrubTrack'
import { TimelineHint } from './components/TimelineHint'
import { Transport } from './components/Transport'
import { fisheyeScale } from './fisheye'
import { readHintDismissed, writeHintDismissed } from './hint'
import { timelineKeyIntent } from './keyboard'
import type { TimeWindow } from './scale'
import styles from './Timeline.module.css'
import { useFisheye } from './useFisheye'

/** The visible window never changes (no zoom/pan) — a single stable reference so every memo
 *  keyed on `window`/`visibleWindow` below stays cheap across re-renders. */
const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]

export interface TimelineProps {
  t: GeoTime
  /** `'density'` is out of scope for this package (see index.ts) — the caller must not pass
   *  it here. */
  scaleKind: 'symlog' | 'linear'
  /** The animated scale over the full domain — see the `scale` bullet in the doc comment
   *  above. */
  scale: TimeScale
  events: readonly TimelineEvent[]
  /** The generated stills, plotted as scene checkpoint pips (W13) distinct from data-driven
   *  `events` — every one is always drawn, with no importance LOD, since these are the images
   *  the viewer sees rather than annotations on the axis. */
  checkpoints?: readonly TimelineCheckpoint[]
  playback: Playback
  onScrub: (t: GeoTime) => void
  onScaleKindChange: (kind: 'symlog' | 'linear') => void
  onPlaybackChange: (playback: Playback) => void
  /** Clicking a checkpoint cluster marker (ADR-019) reports its members here instead of
   *  scrubbing — the caller owns what surface opens (a member-list panel, say). */
  onOpenCluster: (members: readonly TimelineCheckpoint[]) => void
  /** Instantaneous, smoothed years-per-second `t` is advancing at (ADR-016's prototype rate
   *  readout) — passed straight through to `TransportSecondary`. `null`/omitted shows nothing. */
  ratePerSecond?: number | null
}

export function Timeline({
  t,
  scaleKind,
  scale,
  events,
  checkpoints = [],
  playback,
  onScrub,
  onScaleKindChange,
  onPlaybackChange,
  onOpenCluster,
  ratePerSecond = null,
}: TimelineProps) {
  // The first-use hint (brief §2): shown until either dismissed directly or the first
  // successful hover (the gesture that reveals the fisheye lens — the thing this hint exists to
  // teach, now that there is no zoom/pan to discover). Starts hidden and only flips on in an
  // effect (not read synchronously from sessionStorage during render) so a server-rendered
  // first paint never disagrees with the client's own storage — avoiding a hydration mismatch.
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

  // Every position on the track a viewer might need room opened up around (ADR-021): each
  // checkpoint's own instant, plus both ends of every event's uncertainty band. Undistorted
  // (`scale.toUnit`, not `trackScale`'s own) — the lens' gap insertion measures candidate gaps in
  // that same base space (`fisheye.ts`'s own doc comment).
  const markers = useMemo(() => {
    const positions: number[] = []
    for (const checkpoint of checkpoints) positions.push(scale.toUnit(checkpoint.t))
    for (const event of events) {
      positions.push(scale.toUnit(event.tMin))
      positions.push(scale.toUnit(event.tMax))
    }
    return positions.sort((a, b) => a - b)
  }, [checkpoints, events, scale])

  const trackScale = useMemo(
    () => fisheyeScale(scale, fisheye.lens, fisheye.trackWidthPx, markers),
    [scale, fisheye.lens, fisheye.trackWidthPx, markers],
  )

  const handleLensPointer = useCallback(
    (u: number, trackWidthPx: number): void => {
      dismissHint()
      fisheye.pointTo(u, trackWidthPx)
    },
    [dismissHint, fisheye.pointTo],
  )

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const intent = timelineKeyIntent({ key: e.key, target: e.target })
    if (!intent) return
    e.preventDefault()
    switch (intent.type) {
      case 'toggle-play':
        onPlaybackChange({ ...playback, playing: !playback.playing })
        return
      case 'step': {
        const direction = intent.direction === 'prev' ? 'back' : 'forward'
        const target = nearestStepTarget(events, checkpoints, FULL_DOMAIN, t, direction)
        if (target !== undefined) onScrub(target)
        return
      }
    }
  }

  return (
    <div className={styles.timeline} onKeyDown={handleKeyDown}>
      <ScrubTrack
        t={t}
        window={FULL_DOMAIN}
        scale={trackScale}
        events={events}
        checkpoints={checkpoints}
        onScrub={onScrub}
        onOpenCluster={onOpenCluster}
        onLensPointer={handleLensPointer}
        onLensRelease={fisheye.release}
      />
      <AxisTicks window={FULL_DOMAIN} scale={trackScale} />
      {hintVisible && (
        <div className={styles.hintRow}>
          <TimelineHint onDismiss={dismissHint} />
        </div>
      )}
      <div className={styles.controlsRow}>
        <Transport
          t={t}
          window={FULL_DOMAIN}
          events={events}
          checkpoints={checkpoints}
          playback={playback}
          onScrub={onScrub}
          onPlaybackChange={onPlaybackChange}
          ratePerSecond={ratePerSecond}
        />
        <div className={styles.rightControls}>
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
