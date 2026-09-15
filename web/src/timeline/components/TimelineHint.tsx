'use client'

/** The subtle, dismissible first-use hint (brief §2) — shown until the first successful hover
 *  (the gesture that reveals the fisheye lens), or until explicitly dismissed. Purely
 *  presentational: `Timeline` owns *when* it's shown (via `hint.ts`'s sessionStorage-backed
 *  read/write, wrapped in a `useEffect` so a server-rendered first paint never disagrees with
 *  the client).
 *
 *  The wording itself has two forms: the mouse copy talks about hovering and clicking, neither
 *  of which a touch/pen pointer can do — there is no hover, and the press-and-drag gesture is
 *  what both scrubs *and* magnifies (`TouchMagnifier`, ADR-021), not a separate step. Which one
 *  shows is decided by `matchMedia('(pointer: coarse)')`, read only inside a `useEffect` (i.e.
 *  only once mounted on the client) rather than in the initial render/state — the server always
 *  renders the mouse copy, and reading the media query any earlier would make a touch device's
 *  own first client render disagree with that server output and hydrate with a text mismatch. */

import { useEffect, useState } from 'react'

import { GO_TO_ROOT_KEY_HINT, LEAVE_SECTION_KEY_HINT } from '../keyboard'
import styles from './TimelineHint.module.css'

const COARSE_POINTER_QUERY = '(pointer: coarse)'

const MOUSE_HINT =
  'drag to scrub · hover to spread out close events · click a cluster to see them all · [ ] or - = to change speed · ' +
  `${LEAVE_SECTION_KEY_HINT} up a section · ${GO_TO_ROOT_KEY_HINT} for Earth · Shift + ←/→ for the previous/next section`
const TOUCH_HINT = 'press and drag to scrub and magnify · tap a cluster to see them all'

interface TimelineHintProps {
  onDismiss: () => void
}

export function TimelineHint({ onDismiss }: TimelineHintProps) {
  const [coarsePointer, setCoarsePointer] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(COARSE_POINTER_QUERY)
    const onChange = (): void => setCoarsePointer(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return (
    <div className={styles.hint}>
      <span className={styles.text}>{coarsePointer ? TOUCH_HINT : MOUSE_HINT}</span>
      <button type="button" className={styles.dismiss} aria-label="Dismiss hint" onClick={onDismiss}>
        {'×'}
      </button>
    </div>
  )
}
