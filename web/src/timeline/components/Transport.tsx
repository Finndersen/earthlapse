'use client'

/** Playback transport controls. `Timeline.tsx` arranges these into three clusters across its
 *  `.controlsRow` grid — breadcrumbs (the one flexible column) on the left, `sound` +
 *  `TransportCore` + `SpeedSelect` centred over the track, and `EraShortcuts` +
 *  `PlaybackModeToggle` + the scale toggle right-aligned to the gutter — so nothing here ever
 *  shifts position when the breadcrumb's own length changes:
 *
 *  - `TransportCore` — back / play-pause / forward. Back and forward step to the nearest
 *    visible scene (`nearestStepTarget`) rather than by a fixed number of years — a fixed step
 *    has no sane value across a domain that runs from 1 year to 4.6 billion. Events are not
 *    step targets: they are far denser than scenes, so stepping to one usually leaves the same
 *    still on screen and the button looks broken.
 *  - `SpeedSelect` — can also be stepped with `[`/`]`/`-`/`=` (`timeline/keyboard.ts`'s `'speed'`
 *    intent) through the same `SPEED_OPTIONS` the select offers (`../playback`).
 *  - `PlaybackModeToggle` — the scenes/steady mode toggle (ADR-016): a compact two-state
 *    segmented control, ghost style with an amber active state — the shared lens visual language
 *    (`--hud-*` tokens) rather than a new idiom.
 *  - `RateReadout` — its changing text must never reflow the scale toggle beside it, so
 *    `Timeline.tsx` places it last, past everything whose position must stay pixel-identical
 *    while the rate readout's own width does not (a fixed-width slot, always reserved — see its
 *    own doc comment). It is optional and purely presentational: the caller (`Experience.tsx`)
 *    computes and smooths the instantaneous years-per-second next to its playback loop, since
 *    that is where the real per-frame `t` deltas already are; this component only formats and
 *    shows it, and only while playing. */

import { useId } from 'react'

import type { GeoTime, Playback, PlaybackMode } from '@/types/layer'

import { nearestStepTarget, type TimelineCheckpoint } from '../checkpoints'
import { formatRate } from '../format'
import { SPEED_OPTIONS } from '../playback'
import type { TimeWindow } from '../scale'
import styles from './Transport.module.css'

const PLAYBACK_MODES: readonly { value: PlaybackMode; label: string }[] = [
  { value: 'scenes', label: 'Scenes' },
  { value: 'steady', label: 'Steady' },
]

interface TransportCoreProps {
  t: GeoTime
  window: TimeWindow
  checkpoints: readonly TimelineCheckpoint[]
  playback: Playback
  onScrub: (t: GeoTime) => void
  onPlaybackChange: (playback: Playback) => void
}

/** Back / play-pause / forward — the group `Timeline.tsx` centres over the track. */
export function TransportCore({ t, window: visibleWindow, checkpoints, playback, onScrub, onPlaybackChange }: TransportCoreProps) {
  // "back" moves further into the past (older, larger t ago); "forward" moves toward the
  // present (smaller t) — the same direction playback itself advances in.
  const jumpToNeighbour = (direction: 'back' | 'forward'): void => {
    const target = nearestStepTarget(checkpoints, visibleWindow, t, direction)
    if (target !== undefined) onScrub(target)
  }

  return (
    <div className={styles.core}>
      <button
        type="button"
        className={styles.ghostButton}
        aria-label="Back to previous scene"
        title="Back to previous scene"
        onClick={() => jumpToNeighbour('back')}
      >
        {'⏮'}
      </button>
      <button
        type="button"
        className={`${styles.ghostButton} ${styles.playButton} ${playback.playing ? styles.playing : ''}`}
        aria-label={playback.playing ? 'Pause' : 'Play'}
        onClick={() => onPlaybackChange({ ...playback, playing: !playback.playing })}
      >
        {playback.playing ? '⏸' : '▶'}
      </button>
      <button
        type="button"
        className={styles.ghostButton}
        aria-label="Forward to next scene"
        title="Forward to next scene"
        onClick={() => jumpToNeighbour('forward')}
      >
        {'⏭'}
      </button>
    </div>
  )
}

interface SpeedSelectProps {
  playback: Playback
  onPlaybackChange: (playback: Playback) => void
}

/** The playback speed `<select>`, alone — sits centred over the track beside `TransportCore`
 *  (`Timeline.tsx`'s `.controlsCore`), not beside the mode/scale toggles on the row's right. */
export function SpeedSelect({ playback, onPlaybackChange }: SpeedSelectProps) {
  return (
    <select
      className={styles.speedSelect}
      aria-label="Playback speed"
      title="Playback speed — [ / ] or - / = to change"
      value={playback.speed}
      onChange={(e) => onPlaybackChange({ ...playback, speed: Number(e.target.value) })}
    >
      {SPEED_OPTIONS.map((speed) => (
        <option key={speed} value={speed}>
          {speed}x
        </option>
      ))}
    </select>
  )
}

interface PlaybackModeToggleProps {
  playback: Playback
  onPlaybackChange: (playback: Playback) => void
}

/** The scenes/steady mode toggle, alone — sits in the row's right-hand cluster (`Timeline.tsx`'s
 *  `.controlsSecondary`), beside the era shortcuts and scale toggle.
 *
 *  Carries its own visible "Playback mode" label above the buttons, in the shared small-caps HUD
 *  label style `Timeline.module.css`'s `.scaleLabel` already established for the scale toggle
 *  beside it — duplicated here as `.groupLabel` rather than imported, the same reason
 *  `.scaleGroup`'s own doc comment gives for its own duplication (CSS Modules classes are scoped
 *  per file, and this toggle lives in this file, not `Timeline.tsx`). The label is wired to the
 *  group via `aria-labelledby`, not a second, separate `aria-label` repeating the same text — one
 *  accessible name, sourced from the text a sighted user actually reads, per the same convention
 *  `Timeline.tsx`'s scale toggle uses. */
export function PlaybackModeToggle({ playback, onPlaybackChange }: PlaybackModeToggleProps) {
  const modeLabelId = useId()
  return (
    <div className={styles.modeGroup}>
      <span id={modeLabelId} className={styles.groupLabel}>
        Playback mode
      </span>
      <div className={styles.modeToggle} role="group" aria-labelledby={modeLabelId}>
        {PLAYBACK_MODES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={styles.modeButton}
            aria-pressed={playback.mode === value}
            onClick={() => onPlaybackChange({ ...playback, mode: value })}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

interface TimeCompressedBadgeProps {
  /** Whether `'steady'`-mode playback's own rate is currently floored to guarantee every scene a
   *  minimum on-screen dwell (ADR-029) — `Experience.tsx`'s `steadyPacing().floored`, a direct
   *  function of playback state, never an idle timer. */
  visible: boolean
}

/** "Time compressed" (ADR-029): shown only while the steady playhead's own rate is floored below
 *  what `speed` requested to keep a dense cluster of scenes readable (WCAG 2.3.1's three-flashes
 *  safety floor) — the numeric year readout keeps moving at whatever rate `t` implies either way
 *  (see `advanceSteadyPlayhead`'s own doc comment), so this is the one place a viewer is told
 *  playback has quietly slowed to protect that readability. Sits beside `RateReadout` in the same
 *  fixed-width row (`rateReadoutRow`), amber like the playing state and the active mode-toggle
 *  option — the shared `--hud-accent` lens language, not a new idiom.
 *
 *  A fixed-width slot, always mounted (re-review fix, 2026-09-15 — this originally unmounted via
 *  `return null` while not visible, on the reasoning that a handful of years-dense clusters made
 *  this rare enough not to bother reserving space for): a single steady-mode playthrough can
 *  cross several scene territories whose dwell straddles the floor threshold in quick succession,
 *  toggling `visible` up to ten times in a few seconds (live-measured) — unmounting and
 *  remounting a `role="status"` region that often both re-announces it to screen readers more
 *  erratically than a live region toggling its own text is meant to, and repeatedly shifts
 *  `RateReadout`/the scale toggle beside it. `visibility`, not `display`, keeps the slot's width
 *  constant either way (the same pattern `RateReadout` above already uses, for the same reason);
 *  only the text content toggles between the real label and `''`, which is what actually
 *  re-triggers a screen reader's live-region announcement on each genuine transition into the
 *  floor — a permanently-static label, merely shown/hidden by CSS, would never re-announce at
 *  all. */
export function TimeCompressedBadge({ visible }: TimeCompressedBadgeProps) {
  return (
    <span className={styles.timeCompressed} role="status" data-visible={visible}>
      {visible ? 'Time compressed' : ''}
    </span>
  )
}

interface RateReadoutProps {
  /** Instantaneous, smoothed years-per-second `t` is currently advancing at — `null`/omitted
   *  when there is nothing meaningful to show yet (not playing, or the first frame). */
  ratePerSecond?: number | null
  playing: boolean
}

/** The playback rate readout (ADR-016's prototype), in a fixed-width slot reserved whether or
 *  not it currently has anything to show: `Timeline.module.css` sizes `.rateReadout` to
 *  comfortably outlast any `formatRate` output this app can produce, so starting/stopping
 *  playback never shifts the mode toggle or scale toggle beside it — `visibility`, not
 *  `display: none`, keeps the slot in the layout even empty. Placed by the caller (`Timeline.tsx`)
 *  last in the row's right-hand cluster, past everything whose position must stay
 *  pixel-identical. */
export function RateReadout({ ratePerSecond = null, playing }: RateReadoutProps) {
  const visible = playing && ratePerSecond !== null
  return (
    <span className={styles.rateReadout} aria-hidden data-visible={visible}>
      {visible ? `≈ ${formatRate(ratePerSecond)}` : ''}
    </span>
  )
}
