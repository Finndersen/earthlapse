'use client'

/** Playback transport, split into two groups the caller (`Timeline.tsx`) lays out separately so
 *  the primary one can sit centred over the track while the secondary one stays off to the
 *  side, rather than both bunched into a single row whose visual centre would then depend on
 *  the secondary controls' own width:
 *
 *  - `TransportCore` — back / play-pause / forward. Back and forward step to the nearest
 *    visible event *or* checkpoint (`nearestStepTarget`) rather than by a fixed number of years
 *    — a fixed step has no sane value across a domain that runs from 1 year to 4.6 billion, and
 *    a fixed step over events alone would skip past a scene sitting between two of them.
 *  - `TransportSecondary` — the sound toggle (`sound`, follow-up pass item 2: moved here from a
 *    fixed top-right corner so it sits right beside `TransportCore`), the speed select and the
 *    scenes/steady mode toggle (ADR-016). Speed can also be stepped with `[`/`]`/`-`/`=`
 *    (`timeline/keyboard.ts`'s `'speed'` intent, follow-up pass item 3) through the same
 *    `SPEED_OPTIONS` the select offers (`../playback`). The mode toggle is a compact two-state
 *    segmented control, ghost style with an amber active state — the shared lens visual
 *    language (`--hud-*` tokens) rather than a new idiom.
 *  - `RateReadout` — a separate sibling, not part of `TransportSecondary` itself (follow-up
 *    pass item 10): its changing text must never reflow the speed select, mode toggle, scale
 *    toggle or sound controls beside it, so `Timeline.tsx` places it at the outer edge of the
 *    secondary controls, past everything whose position needs to stay pixel-identical while
 *    the rate readout's own width does not (a fixed-width slot, always reserved — see its own
 *    doc comment). It is optional and purely presentational: the caller (`Experience.tsx`)
 *    computes and smooths the instantaneous years-per-second next to its playback loop, since
 *    that is where the real per-frame `t` deltas already are; this component only formats and
 *    shows it, and only while playing. */

import { useId } from 'react'
import type { ReactNode } from 'react'

import type { GeoTime, Playback, PlaybackMode, TimelineEvent } from '@/types/layer'

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
  events: readonly TimelineEvent[]
  checkpoints: readonly TimelineCheckpoint[]
  playback: Playback
  onScrub: (t: GeoTime) => void
  onPlaybackChange: (playback: Playback) => void
}

/** Back / play-pause / forward — the group `Timeline.tsx` centres over the track. */
export function TransportCore({ t, window: visibleWindow, events, checkpoints, playback, onScrub, onPlaybackChange }: TransportCoreProps) {
  // "back" moves further into the past (older, larger t ago); "forward" moves toward the
  // present (smaller t) — the same direction playback itself advances in.
  const jumpToNeighbour = (direction: 'back' | 'forward'): void => {
    const target = nearestStepTarget(events, checkpoints, visibleWindow, t, direction)
    if (target !== undefined) onScrub(target)
  }

  return (
    <div className={styles.core}>
      <button type="button" className={styles.ghostButton} aria-label="Back to previous event" onClick={() => jumpToNeighbour('back')}>
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
      <button type="button" className={styles.ghostButton} aria-label="Forward to next event" onClick={() => jumpToNeighbour('forward')}>
        {'⏭'}
      </button>
    </div>
  )
}

interface TransportSecondaryProps {
  playback: Playback
  onPlaybackChange: (playback: Playback) => void
  /** The sound mute/volume control (`@/audio`'s `<SoundToggle>`), rendered as the first item in
   *  this group so it lands immediately beside `TransportCore`'s play/back/forward (follow-up
   *  pass item 2). Optional so a caller with no audio wired up yet (tests) can omit it. */
  sound?: ReactNode
}

/** Sound toggle, speed select and scenes/steady mode toggle — secondary to `TransportCore`,
 *  laid out beside it rather than centred. The rate readout used to live here too; it is now a
 *  sibling (`RateReadout`, below) so its own width changes can never reflow these.
 *
 *  The mode toggle carries its own visible "Playback mode" label above the buttons (follow-up
 *  pass, user report 2026-09-15 — a bare two-state control read as unlabelled), in the shared
 *  small-caps HUD label style `Timeline.module.css`'s `.scaleLabel` already established for the
 *  scale toggle beside it — duplicated here as `.groupLabel` rather than imported, the same
 *  reason `.scaleGroup`'s own doc comment gives for its own duplication (CSS Modules classes are
 *  scoped per file, and the mode toggle lives in this file, not `Timeline.tsx`). The label is
 *  wired to the group via `aria-labelledby`, not a second, separate `aria-label` repeating the
 *  same text — one accessible name, sourced from the text a sighted user actually reads, per the
 *  same convention `Timeline.tsx`'s scale toggle now uses. */
export function TransportSecondary({ playback, onPlaybackChange, sound }: TransportSecondaryProps) {
  const modeLabelId = useId()
  return (
    <div className={styles.secondary}>
      {sound}
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
 *  not it currently has anything to show (follow-up pass item 10): `Timeline.module.css` sizes
 *  `.rateReadout` to comfortably outlast any `formatRate` output this app can produce, so
 *  starting/stopping playback or switching speeds never shifts the speed select, mode toggle,
 *  scale toggle or sound controls beside it — `visibility`, not `display: none`, keeps the slot
 *  in the layout even empty. Placed by the caller (`Timeline.tsx`) at the outer edge of the
 *  secondary controls, past everything whose position must stay pixel-identical. */
export function RateReadout({ ratePerSecond = null, playing }: RateReadoutProps) {
  const visible = playing && ratePerSecond !== null
  return (
    <span className={styles.rateReadout} aria-hidden data-visible={visible}>
      {visible ? `≈ ${formatRate(ratePerSecond)}` : ''}
    </span>
  )
}
