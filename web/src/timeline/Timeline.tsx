'use client'

/**
 * Props contract for the integrator (W12/W13):
 *
 * - `t`, `scaleKind`, `sectionId`, `events`, `checkpoints`, `playback` are read-only inputs.
 *   Beyond that this component owns only ephemeral pointer-drag bookkeeping, the fisheye lens
 *   (`useFisheye`) and focus restoration after a section change.
 * - The visible window is the selected **era section**'s (ADR-024): `scale.domain`, animated by
 *   the caller's `useAnimatedScale(sectionById(sectionId).window, scaleKind)`. There is still no
 *   free zoom or pan (ADR-021). The section band strip (`SectionBands`), the breadcrumb
 *   (`SectionBreadcrumb`), the previous/next sibling-section buttons flanking the track itself
 *   (`SectionEdgeNav`) and the Dinosaurs/Humans shortcuts (`EraShortcuts`, rendered in
 *   `.controlsSecondary` below) are the ways to change the window with a pointer.
 *   The keyboard equivalents (`keyboard.ts`) are Escape/Backspace up a level, Home/`0` to Earth,
 *   and PageUp-PageDown/Shift+←→ to the previous/next sibling section. All of them report through
 *   `onSelectSection`. Stepping (transport buttons, plain ←/→) stays inside the selected
 *   section's own (at-rest) window, and so does every track target (drag, pip, cluster member):
 *   each is clamped to that window, because while the window animates the track still maps a
 *   wider span.
 * - `onScrub(t)` fires from dragging the scrub track, clicking a checkpoint pip, jumping to a
 *   neighbouring event or checkpoint via the transport's back/forward buttons, or the ←/→
 *   keyboard shortcuts.
 * - `onSelectSection(id)` fires from a section band, a breadcrumb ancestor, an era shortcut, an
 *   edge-nav button or Escape. The caller is expected to move `t` into the section when it was
 *   outside (the time store's `selectSection`).
 * - `onScaleKindChange(kind)` fires from the Symlog/Linear segmented scale toggle.
 * - `onPlaybackChange(playback)` fires from the play/pause button, the speed selector, the
 *   scenes/steady mode toggle (ADR-016), and the space-bar shortcut.
 * - `onOpenCluster(members)` fires when a checkpoint cluster marker (ADR-019) is clicked or
 *   tapped. `ScrubTrack` itself opens an in-track member-list popover (ADR-021) on the same
 *   click, so this is only a notification for a caller that wants to know (e.g. analytics); it
 *   is not required to build any UI in response.
 * - `scale` is the animated, undistorted `TimeScale` over the section window. The caller owns
 *   it rather than this component computing it, so anything else drawn against the same axis
 *   shares the exact object. That covers the expanded `LayerChart` in the chart dock, left
 *   undistorted on purpose (ADR-017).
 * - The scrub track, ruler and section bands are drawn against a second, fisheye-distorted
 *   `trackScale` instead (ADR-017). While the pointer hovers the track, a lens stretches the
 *   region around it so nearby events/pips/ticks spread apart and the rest compresses toward
 *   both ends. `trackScale` is owned here (`useFisheye` + `fisheyeScale(scale, fisheye.lens,
 *   fisheye.trackWidthPx, markers)`) and passed to `<ScrubTrack>`, `<AxisTicks>` and
 *   `<SectionBands>`, so all three stretch in lockstep. `markers` (ADR-021) holds every
 *   checkpoint's `t` and every event's `tMin`/`tMax` that falls inside the window, in
 *   undistorted `scale.toUnit` units, so the lens's density-adaptive gap insertion knows every
 *   position that might need room opened up around it.
 *
 * The caller (holding the single `t` per DESIGN §4) is expected to feed `onScrub` straight
 * into its `t` setter, and to drive playback (`advancePlayhead`/`advanceSteadyPlayhead`,
 * `usePlaybackLoop`) from `playback` and `t` itself. This component does not call either.
 *
 * Chrome-less by design (W13, SHARED VISUAL LANGUAGE): no panel background here or in any
 * child; this floats over whatever darkened surround the shell provides. The current-time
 * readout rides above the playhead on the scrub track. The shell shows the large era/time title
 * elsewhere (`eraNameForTime`). `SectionEdgeNav` flanks the scrub track, ruler and section bands
 * together (so all three stay pixel-aligned) with the previous/next sibling-section buttons at
 * its far left/right edges; below that sits one controls row, three clusters across
 * `.controlsRow`'s grid: the breadcrumb alone in `.controlsSections` (the row's one flexible
 * column, free to grow or shrink with the trail); the sound toggle, `TransportCore`
 * (back/play/forward) and `SpeedSelect` centred in `.controlsCore`; and `EraShortcuts`,
 * `PlaybackModeToggle`, the scale toggle and `RateReadout` right-aligned in `.controlsSecondary`.
 * Every control outside the breadcrumb is fixed-width, so none of them ever shifts position when
 * the breadcrumb's own length changes (`controlsRow`'s doc comment in Timeline.module.css has the
 * layout mechanics).
 */

import { useCallback, useEffect, useId, useMemo, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'

import type { GeoTime, Playback, TimeScale, TimelineEvent } from '@/types/layer'

import { nearestStepTarget, type TimelineCheckpoint } from './checkpoints'
import { AxisTicks } from './components/AxisTicks'
import { EraShortcuts } from './components/EraShortcuts'
import { ScrubTrack } from './components/ScrubTrack'
import { SectionBands } from './components/SectionBands'
import { SectionBreadcrumb } from './components/SectionBreadcrumb'
import { SectionEdgeNav } from './components/SectionEdgeNav'
import { PlaybackModeToggle, RateReadout, SpeedSelect, TimeCompressedBadge, TransportCore } from './components/Transport'
import { fisheyeScale } from './fisheye'
import { timelineKeyIntent } from './keyboard'
import { stepSpeed } from './playback'
import type { TimeWindow } from './scale'
import {
  continuationSection,
  parentSection,
  previousSiblingStep,
  ROOT_SECTION_ID,
  sectionById,
  sectionSymlogKnee,
  type SectionId,
} from './sections'
import styles from './Timeline.module.css'
import { useFisheye } from './useFisheye'
import { clamp } from './util'

/** Explanations of the scale toggle's two options, shown as each button's `title` tooltip;
 *  wording matches DESIGN §3's own table ("`symlog`... linear region near present"; "`linear`...
 *  true proportional"). */
const SYMLOG_SCALE_HINT = 'Symlog scale: logarithmic in deep time, linear near the present — keeps recent history legible'
const LINEAR_SCALE_HINT = 'Linear scale: true proportional — most of history collapses to a sliver near the present edge'

export interface TimelineProps {
  t: GeoTime
  /** `'density'` is out of scope for this package (see index.ts) — the caller must not pass
   *  it here. */
  scaleKind: 'symlog' | 'linear'
  /** The animated scale over the selected section's window. See the `scale` bullet in the doc
   *  comment above. */
  scale: TimeScale
  /** The era section the timeline shows (ADR-024). */
  sectionId: SectionId
  events: readonly TimelineEvent[]
  /** The generated stills, plotted as scene checkpoint pips (W13) distinct from data-driven
   *  `events` — every one is always drawn, with no importance LOD, since these are the images
   *  the viewer sees rather than annotations on the axis. */
  checkpoints?: readonly TimelineCheckpoint[]
  playback: Playback
  onScrub: (t: GeoTime) => void
  onSelectSection: (id: SectionId) => void
  onScaleKindChange: (kind: 'symlog' | 'linear') => void
  onPlaybackChange: (playback: Playback) => void
  /** Clicking a checkpoint cluster marker (ADR-019) reports its members here instead of
   *  scrubbing — the caller owns what surface opens (a member-list panel, say). */
  onOpenCluster: (members: readonly TimelineCheckpoint[]) => void
  /** Instantaneous, smoothed years-per-second `t` is advancing at (ADR-016's prototype rate
   *  readout) — passed straight through to `RateReadout`. `null`/omitted shows nothing. */
  ratePerSecond?: number | null
  /** True exactly while `'steady'`-mode playback's own rate is floored below what `speed`
   *  requested, to guarantee every scene a minimum on-screen dwell (ADR-029) — passed straight
   *  through to the "time compressed" marker beside `RateReadout`. A direct function of playback
   *  state (`Experience.tsx`'s own `steadyPacing` call inside its playback loop), never an idle
   *  timer. Defaults to `false` (tests, and any caller with no steady-mode floor to report). */
  timeCompressed?: boolean
  /** The sound mute/volume control (`@/audio`'s `<SoundToggle>`), rendered as the first item in
   *  `.controlsCore` — immediately before `TransportCore`'s play/back/forward, in the row's
   *  centred, fixed-width `auto` column rather than sharing a flex row with the breadcrumb, so it
   *  never shifts position as the breadcrumb trail grows or shrinks. Optional so a caller with no
   *  audio wired up (tests) can omit it. */
  sound?: ReactNode
  /** Whether some other overlay outside this component's own DOM subtree — the chart dock
   *  (`@/layers`'s `LayerChart`) or the expanded globe (`@/globe`'s `Globe`) — is currently open.
   *  Both close themselves on `Escape` via their own `window`-level listener, outside React's
   *  tree, so neither can `stopPropagation()` the way `ClusterPopover` and `shell/Panel` do;
   *  without this, a bare `Escape` with focus inside the timeline would close the overlay *and*
   *  climb a section in the same keypress. `Timeline` skips `'leave-section'` for `Escape` (not
   *  `Backspace`, which no overlay binds) while this is true, leaving the key entirely to
   *  whichever overlay's own listener owns it. Optional, defaulting to `false`. */
  overlayOpen?: boolean
}

export function Timeline({
  t,
  scaleKind,
  scale,
  sectionId,
  events,
  checkpoints = [],
  playback,
  onScrub,
  onSelectSection,
  onScaleKindChange,
  onPlaybackChange,
  onOpenCluster,
  ratePerSecond = null,
  timeCompressed = false,
  sound,
  overlayOpen = false,
}: TimelineProps) {
  // Visible name for the scale toggle's `role="group"`, stacked above its buttons rather than
  // beside them — `aria-labelledby`, not a second, separate `aria-label` repeating the same text,
  // so the group's one accessible name is sourced from what a sighted user actually reads (same
  // convention `TransportSecondary`'s mode toggle uses for the same reason).
  const scaleLabelId = useId()

  // The window being drawn (mid-animation during a section change) versus the selected
  // section's own window, which stepping stays inside.
  const visibleWindow: TimeWindow = scale.domain
  const sectionWindow = sectionById(sectionId).window
  // Same knee the caller's `useAnimatedScale` built `scale` with (`sections.ts`'s
  // `sectionSymlogKnee`) — kept in sync here rather than recomputed from `visibleWindow` alone,
  // so `AxisTicks`'s near-linear judgement never disagrees with the scale it's ticking. See
  // `sectionSymlogKnee`'s own doc comment for why a leaf section's knee isn't the bare
  // `symlogKnee(window)` default.
  const sectionKnee = sectionSymlogKnee(sectionId)

  // For 700ms after a section change the track still maps the wider animated window, so a press
  // there could land outside the section just chosen and make the store climb to another one.
  // Every track target is clamped to the section's own window instead.
  const scrubWithinSection = useCallback(
    (target: GeoTime): void => onScrub(clamp(target, sectionWindow[0], sectionWindow[1])),
    [onScrub, sectionWindow],
  )

  // The fisheye lens (ADR-017): owned here, not in `ScrubTrack`, so `AxisTicks` and
  // `SectionBands` can be distorted by the exact same lens the track is.
  const fisheye = useFisheye()

  // Every position inside the window a viewer might need room opened up around (ADR-021): each
  // checkpoint's own instant, plus both ends of every event's uncertainty band. Undistorted
  // (`scale.toUnit`, not `trackScale`'s own), since the lens's gap insertion measures candidate
  // gaps in that same base space. Positions outside the window (u outside [0, 1]) are left out.
  const markers = useMemo(() => {
    const positions: number[] = []
    const push = (u: number): void => {
      if (u >= 0 && u <= 1) positions.push(u)
    }
    for (const checkpoint of checkpoints) push(scale.toUnit(checkpoint.t))
    for (const event of events) {
      push(scale.toUnit(event.tMin))
      push(scale.toUnit(event.tMax))
    }
    return positions.sort((a, b) => a - b)
  }, [checkpoints, events, scale])

  const trackScale = useMemo(
    () => fisheyeScale(scale, fisheye.lens, fisheye.trackWidthPx, markers),
    [scale, fisheye.lens, fisheye.trackWidthPx, markers],
  )


  // A band or breadcrumb click (or Escape) swaps out the very element that had focus. When
  // focus was inside the timeline at that moment, it goes to the new band strip rather than
  // falling back to <body>, where Escape and Tab would no longer reach the timeline.
  // Playback-driven section changes never move focus.
  const rootRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef(false)
  const selectSection = (id: SectionId): void => {
    restoreFocusRef.current = rootRef.current?.contains(document.activeElement) ?? false
    onSelectSection(id)
  }
  useEffect(() => {
    if (!restoreFocusRef.current) return
    restoreFocusRef.current = false
    const root = rootRef.current
    if (root === null || (document.activeElement !== null && root.contains(document.activeElement))) return
    root.querySelector<HTMLElement>('[data-section-bands]')?.focus({ preventScroll: true })
  }, [sectionId])

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // An open chart dock or expanded globe owns a bare Escape itself (see `overlayOpen`'s own
    // doc comment above) — leave it alone entirely rather than also climbing a section.
    if (e.key === 'Escape' && overlayOpen) return
    const intent = timelineKeyIntent({ key: e.key, target: e.target, shiftKey: e.shiftKey })
    if (!intent) return
    switch (intent.type) {
      case 'toggle-play':
        e.preventDefault()
        onPlaybackChange({ ...playback, playing: !playback.playing })
        return
      case 'step': {
        e.preventDefault()
        const direction = intent.direction === 'prev' ? 'back' : 'forward'
        const target = nearestStepTarget(checkpoints, sectionWindow, t, direction)
        if (target !== undefined) onScrub(target)
        return
      }
      case 'leave-section': {
        const parent = parentSection(sectionId)
        if (parent === undefined) return
        e.preventDefault()
        selectSection(parent.id)
        return
      }
      case 'go-to-root': {
        if (sectionId === ROOT_SECTION_ID) return
        e.preventDefault()
        selectSection(ROOT_SECTION_ID)
        return
      }
      case 'step-sibling': {
        const target = intent.direction === 'next' ? continuationSection(sectionId) : previousSiblingStep(sectionId)
        if (target === undefined) return
        e.preventDefault()
        selectSection(target.id)
        return
      }
      case 'speed': {
        e.preventDefault()
        onPlaybackChange({ ...playback, speed: stepSpeed(playback.speed, intent.direction) })
        return
      }
    }
  }

  return (
    <div ref={rootRef} className={styles.timeline} data-testid="timeline-root" onKeyDown={handleKeyDown}>
      <SectionEdgeNav sectionId={sectionId} onSelectSection={selectSection}>
        <ScrubTrack
          t={t}
          window={visibleWindow}
          scale={trackScale}
          events={events}
          checkpoints={checkpoints}
          onScrub={scrubWithinSection}
          onOpenCluster={onOpenCluster}
          onLensPointer={fisheye.pointTo}
          onLensRelease={fisheye.release}
        />
        <AxisTicks window={visibleWindow} scale={trackScale} knee={sectionKnee} />
        <SectionBands sectionId={sectionId} t={t} scale={trackScale} onSelectSection={selectSection} />
      </SectionEdgeNav>
      <div className={styles.controlsRow}>
        {/* `data-testid`s: stable QA-harness hooks for the row's own left/right edges
            (`Timeline.module.css`'s `--timeline-gutter` doc comment) — CSS Modules' hashed class
            names have nothing stable to select by otherwise. */}
        <div className={styles.controlsSections} data-testid="timeline-controls-sections">
          <SectionBreadcrumb sectionId={sectionId} onSelectSection={selectSection} />
        </div>
        <div className={styles.controlsCore} data-testid="timeline-controls-core">
          {sound}
          <TransportCore
            t={t}
            window={sectionWindow}
            checkpoints={checkpoints}
            playback={playback}
            onScrub={onScrub}
            onPlaybackChange={onPlaybackChange}
          />
          <SpeedSelect playback={playback} onPlaybackChange={onPlaybackChange} />
        </div>
        <div className={styles.controlsSecondary} data-testid="timeline-controls-secondary">
          <EraShortcuts sectionId={sectionId} onSelectSection={selectSection} />
          <PlaybackModeToggle playback={playback} onPlaybackChange={onPlaybackChange} />
          <div className={styles.scaleGroup}>
            <span id={scaleLabelId} className={styles.scaleLabel}>
              Scale
            </span>
            <div className={styles.scaleOptions} role="group" aria-labelledby={scaleLabelId}>
              <button
                type="button"
                className={styles.scaleButton}
                aria-pressed={scaleKind === 'symlog'}
                title={SYMLOG_SCALE_HINT}
                onClick={() => onScaleKindChange('symlog')}
              >
                Symlog
              </button>
              <button
                type="button"
                className={styles.scaleButton}
                aria-pressed={scaleKind === 'linear'}
                title={LINEAR_SCALE_HINT}
                onClick={() => onScaleKindChange('linear')}
              >
                Linear
              </button>
            </div>
          </div>
          <div className={styles.rateReadoutRow}>
            <TimeCompressedBadge visible={timeCompressed} />
            <RateReadout ratePerSecond={ratePerSecond} playing={playback.playing} />
          </div>
        </div>
      </div>
    </div>
  )
}
