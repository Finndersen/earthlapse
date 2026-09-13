'use client'

/** Back / play-pause / forward / speed transport. Back and forward step to the nearest
 *  visible event *or* checkpoint (`nearestStepTarget`) rather than by a fixed number of years
 *  — a fixed step has no sane value across a domain that runs from 1 year to 4.6 billion, and
 *  a fixed step over events alone would skip past a scene sitting between two of them. */

import type { GeoTime, Playback, TimelineEvent } from '@/types/layer'

import { nearestStepTarget, type TimelineCheckpoint } from '../checkpoints'
import type { TimeWindow } from '../scale'
import styles from './Transport.module.css'

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64] as const

interface TransportProps {
  t: GeoTime
  window: TimeWindow
  events: readonly TimelineEvent[]
  checkpoints: readonly TimelineCheckpoint[]
  playback: Playback
  onScrub: (t: GeoTime) => void
  onPlaybackChange: (playback: Playback) => void
}

export function Transport({ t, window: visibleWindow, events, checkpoints, playback, onScrub, onPlaybackChange }: TransportProps) {
  const spanYears = visibleWindow[1] - visibleWindow[0]

  // "back" moves further into the past (older, larger t ago); "forward" moves toward the
  // present (smaller t) — the same direction playback itself advances in.
  const jumpToNeighbour = (direction: 'back' | 'forward'): void => {
    const target = nearestStepTarget(events, checkpoints, visibleWindow, spanYears, t, direction)
    if (target !== undefined) onScrub(target)
  }

  return (
    <div className={styles.transport}>
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
    </div>
  )
}
