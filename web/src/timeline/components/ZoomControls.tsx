'use client'

/** −, + and "fit all" buttons, plus the subtle "following" indicator during playback (README
 *  §4). Presentational — the caller owns what each button actually does. */

import { usePrefersReducedMotion } from '../usePrefersReducedMotion'
import styles from './ZoomControls.module.css'

interface ZoomControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFitAll: () => void
  following: boolean
}

export function ZoomControls({ onZoomIn, onZoomOut, onFitAll, following }: ZoomControlsProps) {
  const reducedMotion = usePrefersReducedMotion()
  return (
    <div className={styles.zoomControls}>
      <button type="button" aria-label="Zoom out" title="Zoom out" onClick={onZoomOut} className={styles.ghostButton}>
        {'−'}
      </button>
      <button type="button" aria-label="Zoom in" title="Zoom in" onClick={onZoomIn} className={styles.ghostButton}>
        {'+'}
      </button>
      <button type="button" aria-label="Fit all" title="Fit all of Earth's history" onClick={onFitAll} className={styles.ghostButton}>
        {'⤢'}
      </button>
      <span
        aria-live="polite"
        className={styles.followingIndicator}
        style={{ opacity: following ? 1 : 0, transition: reducedMotion ? 'none' : 'opacity 200ms ease' }}
      >
        {following ? 'following' : ''}
      </span>
    </div>
  )
}
