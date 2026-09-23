'use client'

/** Playback transport controls. `Timeline.tsx` arranges these across its grid: the breadcrumb on
 *  the left; `SpeedControl`, `TransportCore` and `RateReadout` (the rate, the buttons that run it,
 *  and the result) centred over the track; `PlaybackModeToggle` and the scale toggle right-aligned
 *  — so nothing here shifts when the breadcrumb's length changes. The sound/volume control
 *  (`@/audio`'s `<SoundToggle>`) is passed through by the caller, not owned here.
 *
 *  - `TransportCore` — back / play-pause / forward. Back and forward step to the nearest
 *    visible scene (`nearestStepTarget`) rather than by a fixed number of years — a fixed step
 *    has no sane value across a domain that runs from 1 year to 4.6 billion. Events are not
 *    step targets: they are far denser than scenes, so stepping to one usually leaves the same
 *    still on screen and the button looks broken.
 *  - `SpeedControl` — the active mode's rate on a `RateScroller`, also stepped with `[`/`]`/`-`/`=`
 *    (`timeline/keyboard.ts`'s `'speed'` intent) through the same detents (`../playbackRates`).
 *  - `PlaybackModeToggle` — the scenes/steady mode toggle (ADR-016): a compact two-state
 *    segmented control, ghost style with an amber active state — the shared lens visual language
 *    (`--hud-*` tokens) rather than a new idiom.
 *  - `RateReadout` — the measured rate `t` is advancing at, the mirror of `SpeedControl` across
 *    the transport buttons. The caller (`Experience.tsx`) computes and smooths it next to its
 *    playback loop, where the real per-frame `t` deltas are; this component only formats and
 *    shows it, and only while playing. */

import { useId, useMemo } from 'react'
import type { ReactNode } from 'react'

import type { GeoTime, Playback, PlaybackMode } from '@/types/layer'

import { nearestStepTarget, type TimelineCheckpoint } from '../checkpoints'
import { formatRate } from '../format'
import {
  activeRate,
  detentCaption,
  detentLabel,
  detentValueText,
  nearestDetentIndex,
  rateDetents,
  withActiveRate,
} from '../playbackRates'
import type { TimeWindow } from '../scale'
import { RateScroller } from './RateScroller'
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

interface SpeedControlProps {
  playback: Playback
  onPlaybackChange: (playback: Playback) => void
}

/** The playback rate picker for the current mode: a multiplier in scenes mode, years per second
 *  in steady mode. Each mode keeps its own rate, so switching mode swaps the detent table. */
export function SpeedControl({ playback, onPlaybackChange }: SpeedControlProps) {
  const { mode } = playback
  const values = rateDetents(mode)
  const detents = useMemo(
    () => values.map((value) => ({ value, label: detentLabel(mode, value), valueText: detentValueText(mode, value) })),
    [mode, values],
  )
  return (
    <RateScroller
      detents={detents}
      index={nearestDetentIndex(values, activeRate(playback))}
      onChange={(index) => onPlaybackChange(withActiveRate(playback, values[index]!))}
      label={mode === 'scenes' ? 'Playback speed' : 'Playback rate'}
      caption={detentCaption(mode)}
      title={`${mode === 'scenes' ? 'Playback speed' : 'Playback rate'} — drag, scroll, or [ / ] to change`}
    />
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

interface RateReadoutProps {
  /** Instantaneous, smoothed years-per-second `t` is currently advancing at — `null`/omitted
   *  when there is nothing meaningful to show yet (not playing, or the first frame). */
  ratePerSecond?: number | null
  playing: boolean
  /** Whether steady playback is currently slowed below the chosen rate so a dense run of scenes
   *  never flashes past (ADR-029) — `Experience.tsx`'s `steadyRegime.floored`. */
  floored?: boolean
}

/** The measured playback rate, in a fixed-width slot reserved whether or not it has anything to
 *  show (`visibility`, not `display`), so starting or stopping playback never shifts the transport.
 *  While the steady floor holds it is amber and reads below the rate the picker shows.
 *
 *  The number changes every frame, so it is hidden from assistive technology; the status region
 *  beside it carries only the floor, and its text toggling between the cue and `''` announces each
 *  transition into the floor. */
export function RateReadout({ ratePerSecond = null, playing, floored = false }: RateReadoutProps) {
  const visible = playing && ratePerSecond !== null
  const slowed = visible && floored
  return (
    <span className={styles.rateReadout} data-visible={visible} data-floored={slowed}>
      <span aria-hidden="true">{visible ? formatRate(ratePerSecond) : ''}</span>
      <span className={styles.visuallyHidden} role="status">
        {slowed ? 'Playback slowed for scenes' : ''}
      </span>
    </span>
  )
}
