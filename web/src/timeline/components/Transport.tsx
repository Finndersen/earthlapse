'use client'

/** Back / play-pause / forward / speed transport. Back and forward step between visible
 *  events rather than by a fixed number of years — a fixed step has no sane value across a
 *  domain that runs from 1 year to 4.6 billion. */

import type { GeoTime, Playback, TimelineEvent } from '@/types/layer'

import { visibleEvents } from '../lod'
import type { TimeWindow } from '../scale'

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64] as const

interface TransportProps {
  t: GeoTime
  window: TimeWindow
  events: readonly TimelineEvent[]
  playback: Playback
  onScrub: (t: GeoTime) => void
  onPlaybackChange: (playback: Playback) => void
}

export function Transport({ t, window: visibleWindow, events, playback, onScrub, onPlaybackChange }: TransportProps) {
  const spanYears = visibleWindow[1] - visibleWindow[0]
  const shown = visibleEvents(events, visibleWindow, spanYears)

  // "back" moves further into the past (older, larger t ago); "forward" moves toward the
  // present (smaller t) — the same direction playback itself advances in.
  const jumpToNeighbourEvent = (direction: 'back' | 'forward'): void => {
    const candidates = direction === 'back' ? shown.filter((e) => e.tMin > t) : shown.filter((e) => e.tMax < t)
    if (candidates.length === 0) return
    const nearest =
      direction === 'back'
        ? candidates.reduce((a, b) => (a.tMin < b.tMin ? a : b))
        : candidates.reduce((a, b) => (a.tMax > b.tMax ? a : b))
    onScrub((nearest.tMin + nearest.tMax) / 2)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button type="button" aria-label="Back to previous event" onClick={() => jumpToNeighbourEvent('back')}>
        {'⏮'}
      </button>
      <button
        type="button"
        aria-label={playback.playing ? 'Pause' : 'Play'}
        onClick={() => onPlaybackChange({ ...playback, playing: !playback.playing })}
      >
        {playback.playing ? '⏸' : '▶'}
      </button>
      <button type="button" aria-label="Forward to next event" onClick={() => jumpToNeighbourEvent('forward')}>
        {'⏭'}
      </button>
      <select
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
