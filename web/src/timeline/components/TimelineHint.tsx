'use client'

/** The subtle, dismissible first-use hint (brief §2) — shown until the first successful
 *  zoom/pan, or until explicitly dismissed. Purely presentational: `Timeline` owns *when* it's
 *  shown (via `hint.ts`'s sessionStorage-backed read/write, wrapped in a `useEffect` so a
 *  server-rendered first paint never disagrees with the client). */

import styles from './TimelineHint.module.css'

interface TimelineHintProps {
  onDismiss: () => void
}

export function TimelineHint({ onDismiss }: TimelineHintProps) {
  return (
    <div className={styles.hint}>
      <span className={styles.text}>drag to scrub · scroll to zoom · drag the ruler to pan</span>
      <button type="button" className={styles.dismiss} aria-label="Dismiss hint" onClick={onDismiss}>
        {'×'}
      </button>
    </div>
  )
}
