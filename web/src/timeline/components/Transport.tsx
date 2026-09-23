'use client'

/** Playback transport controls. `Timeline.tsx` arranges these into three clusters across its
 *  `.controlsRow` grid — breadcrumbs (the one flexible column) on the left; `SpeedSelect` paired
 *  with `RateReadout`/`TimeCompressedBadge` (one logical "speed + its result" group) followed by
 *  `TransportCore`, both centred over the track; and `PlaybackModeToggle` + the
 *  scale toggle right-aligned to the gutter — so nothing here ever shifts position when the
 *  breadcrumb's own length changes. The sound/volume control (`@/audio`'s `<SoundToggle>`) also
 *  lives in `.controlsSecondary`, passed through by the caller rather than owned here — see
 *  `Timeline.tsx`'s own doc comment:
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
 *  - `RateReadout` — the mirror of `SpeedSelect` across the transport buttons: the select sets the
 *    rate on one side, the readout shows the result on the other, each packed against the buttons
 *    so the pair reads as one control wrapped around them. A fixed-width slot, always reserved (see its own doc comment), so starting or
 *    stopping playback never moves `TransportCore` beside it or anything past it in the row. It
 *    is optional and purely presentational: the caller (`Experience.tsx`) computes and smooths
 *    the instantaneous years-per-second next to its playback loop, since that is where the real
 *    per-frame `t` deltas already are; this component only formats and shows it, and only while
 *    playing. */

import { useId } from 'react'
import type { ReactNode } from 'react'

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

/* Drawn, not typed. The transport used to render the literal characters `⏮ ▶ ⏸ ⏭`, which are all
   emoji-presentation candidates: Android resolves `⏸` through the colour emoji font, painting a
   blue rounded square instead of a monochrome glyph, so the pause state showed a coloured box
   inside the HUD's own ring. A variation selector only asks for text presentation; an inline path
   does not depend on which fonts a device happens to ship. Sized in `em` so the existing
   `font-size` step between `.ghostButton` and the larger `.playButton` still scales them. */
function TransportIcon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false">
      {children}
    </svg>
  )
}

const BACK_ICON = (
  <>
    <rect x="2.6" y="3.2" width="1.7" height="9.6" rx="0.5" />
    <path d="M13.4 3.9v8.2a.5.5 0 0 1-.77.42L5.9 8.42a.5.5 0 0 1 0-.84l6.73-4.1a.5.5 0 0 1 .77.42Z" />
  </>
)

const FORWARD_ICON = (
  <>
    <path d="M2.6 3.9v8.2a.5.5 0 0 0 .77.42l6.73-4.1a.5.5 0 0 0 0-.84L3.37 3.48a.5.5 0 0 0-.77.42Z" />
    <rect x="11.7" y="3.2" width="1.7" height="9.6" rx="0.5" />
  </>
)

const PLAY_ICON = <path d="M4.2 3.3v9.4a.5.5 0 0 0 .76.43l7.7-4.7a.5.5 0 0 0 0-.86l-7.7-4.7a.5.5 0 0 0-.76.43Z" />

const PAUSE_ICON = (
  <>
    <rect x="4.2" y="3.2" width="2.7" height="9.6" rx="0.6" />
    <rect x="9.1" y="3.2" width="2.7" height="9.6" rx="0.6" />
  </>
)

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
        <TransportIcon>{BACK_ICON}</TransportIcon>
      </button>
      <button
        type="button"
        className={`${styles.ghostButton} ${styles.playButton} ${playback.playing ? styles.playing : ''}`}
        aria-label={playback.playing ? 'Pause' : 'Play'}
        onClick={() => onPlaybackChange({ ...playback, playing: !playback.playing })}
      >
        <TransportIcon>{playback.playing ? PAUSE_ICON : PLAY_ICON}</TransportIcon>
      </button>
      <button
        type="button"
        className={styles.ghostButton}
        aria-label="Forward to next scene"
        title="Forward to next scene"
        onClick={() => jumpToNeighbour('forward')}
      >
        <TransportIcon>{FORWARD_ICON}</TransportIcon>
      </button>
    </div>
  )
}

interface SpeedSelectProps {
  playback: Playback
  onPlaybackChange: (playback: Playback) => void
}

/** The playback speed `<select>`, alone — sits centred over the track grouped with `RateReadout`
 *  (`Timeline.tsx`'s `.speedGroup`, itself inside `.controlsCore` beside `TransportCore`), not
 *  beside the mode/scale toggles on the row's right. */
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
 *  `.controlsSecondary`), beside the scale toggle.
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
 *  playback has quietly slowed to protect that readability. Shares `RateReadout`'s row
 *  (`rateReadoutRow`: under the number on desktop, outboard of it in the compact layouts) — the
 *  number keeps the place beside the transport buttons — amber like the playing state and the
 *  active mode-toggle option: the shared `--hud-accent` lens language, not a new idiom.
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
 *  not it currently has anything to show: `Transport.module.css` sizes `.rateReadout` to
 *  comfortably outlast any `formatRate` output this app can produce, so starting/stopping
 *  playback never shifts `TransportCore` beside it — `visibility`, not `display: none`, keeps the
 *  slot in the layout even empty. Placed by the caller (`Timeline.tsx`) grouped with `SpeedSelect`
 *  in `.speedGroup`, to the left of `TransportCore`. */
export function RateReadout({ ratePerSecond = null, playing }: RateReadoutProps) {
  const visible = playing && ratePerSecond !== null
  return (
    <span className={styles.rateReadout} aria-hidden data-visible={visible}>
      {visible ? formatRate(ratePerSecond) : ''}
    </span>
  )
}
