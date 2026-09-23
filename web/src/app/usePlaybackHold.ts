import { useMemo, useRef } from 'react'

/**
 * Pauses playback while an overlay is open and resumes it on close only if the overlay was what
 * stopped it. Imperative rather than keyed on an `open` flag because an overlay can hand its
 * remembered state to another that replaces it (`release`/`adopt`) rather than resuming.
 */
export interface PlaybackHold {
  /** Remembers whether playback is running, then pauses it. */
  pause(): void
  /** Resumes playback if it was running when `pause` was called, and forgets that fact. */
  resume(): void
  /** Forgets the remembered fact without resuming, returning it for a hand-off via `adopt`. */
  release(): boolean
  /** Takes over a remembered fact from another hold, e.g. one overlay replacing another. */
  adopt(wasPlaying: boolean): void
}

/** The returned hold is stable across renders; it reads `playing` as of the latest render. */
export function usePlaybackHold(playing: boolean, setPlaying: (playing: boolean) => void): PlaybackHold {
  const playingRef = useRef(playing)
  playingRef.current = playing
  const setPlayingRef = useRef(setPlaying)
  setPlayingRef.current = setPlaying
  const wasPlayingRef = useRef(false)

  return useMemo<PlaybackHold>(
    () => ({
      pause() {
        wasPlayingRef.current = playingRef.current
        if (playingRef.current) setPlayingRef.current(false)
      },
      resume() {
        if (!wasPlayingRef.current) return
        wasPlayingRef.current = false
        setPlayingRef.current(true)
      },
      release() {
        const wasPlaying = wasPlayingRef.current
        wasPlayingRef.current = false
        return wasPlaying
      },
      adopt(wasPlaying) {
        wasPlayingRef.current = wasPlaying
      },
    }),
    [],
  )
}
