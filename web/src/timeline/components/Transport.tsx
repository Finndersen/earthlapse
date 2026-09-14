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
 *  - `TransportSecondary` — speed select, the scenes/steady mode toggle (ADR-016) and the rate
 *    readout. The mode toggle is a compact two-state segmented control, ghost style with an
 *    amber active state — the shared lens visual language (`--hud-*` tokens) rather than a new
 *    idiom. The rate readout (`ratePerSecond`) is an optional, purely presentational prop: the
 *    caller (`Experience.tsx`) computes and smooths the instantaneous years-per-second next to
 *    its playback loop, since that is where the real per-frame `t` deltas already are; this
 *    component only formats and shows it, and only while playing. */

import type { GeoTime, Playback, PlaybackMode, TimelineEvent } from '@/types/layer'

import { nearestStepTarget, type TimelineCheckpoint } from '../checkpoints'
import { formatRate } from '../format'
import type { TimeWindow } from '../scale'
import styles from './Transport.module.css'

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64] as const

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
  /** Instantaneous, smoothed years-per-second `t` is currently advancing at — `null`/omitted
   *  when there is nothing meaningful to show yet (not playing, or the first frame). Shown
   *  beside the mode toggle only while `playback.playing`. */
  ratePerSecond?: number | null
}

/** Speed select, scenes/steady mode toggle and rate readout — secondary to `TransportCore`,
 *  laid out beside it rather than centred. */
export function TransportSecondary({ playback, onPlaybackChange, ratePerSecond = null }: TransportSecondaryProps) {
  return (
    <div className={styles.secondary}>
      <select
        className={styles.speedSelect}
        aria-label="Playback speed"
        value={playback.speed}
        onChange={(e) => onPlaybackChange({ ...playback, speed: Number(e.target.value) })}
      >
        {SPEED_OPTIONS.map((speed) => (
          <option key={speed} value={speed}>
            {speed}x
          </option>
        ))}
      </select>
      <div className={styles.modeToggle} role="group" aria-label="Playback mode">
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
      {playback.playing && ratePerSecond !== null && (
        <span className={styles.rateReadout} aria-hidden>
          ≈ {formatRate(ratePerSecond)}
        </span>
      )}
    </div>
  )
}
