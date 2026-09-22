/**
 * The loading screen: a small rotating Earth, the product title and a determinate progress bar.
 * Drawn entirely in inline SVG and CSS so it needs no fetch of its own, and rendered by the static
 * export's prerender, so it is on screen before any script runs. Under reduced motion the globe
 * holds still.
 */

import styles from './LoadingScreen.module.css'

/** Two copies of one continent strip, side by side, scrolled by exactly one copy's width so the
 *  loop has no seam. The strip is wider than the globe, so the same coast is never on both limbs. */
const STRIP_WIDTH = 120

function Continents() {
  return (
    <>
      <path d="M8 22c6-5 14-4 17 1s-1 9 1 13 7 6 5 11-9 7-13 3-9-10-11-16 0-9 1-12Z" />
      <path d="M40 18c7-2 13 1 15 6s-2 8-7 9-11-1-12-5 0-8 4-10Z" />
      <path d="M44 44c8-2 14 2 14 8s-6 10-12 10-10-4-10-9 2-8 8-9Z" />
      <path d="M72 26c9-4 18-2 22 3s1 10-5 12-8 7-14 6-9-6-8-11 1-8 5-10Z" />
      <path d="M92 52c5-1 9 1 9 5s-4 6-8 5-5-3-5-6 1-3 4-4Z" />
      <ellipse cx="108" cy="30" rx="5" ry="8" transform="rotate(18 108 30)" />
    </>
  )
}

function LoadingGlobe() {
  return (
    <svg className={styles.globe} viewBox="0 0 80 80" aria-hidden="true">
      <defs>
        <radialGradient id="loading-sea" cx="36%" cy="30%" r="80%">
          <stop offset="0" stopColor="#5aa6d2" />
          <stop offset="1" stopColor="#17405c" />
        </radialGradient>
        <linearGradient id="loading-night" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0.42" stopColor="#04080d" stopOpacity="0" />
          <stop offset="0.72" stopColor="#04080d" stopOpacity="0.72" />
          <stop offset="1" stopColor="#04080d" stopOpacity="0.9" />
        </linearGradient>
        <radialGradient id="loading-limb" cx="50%" cy="50%" r="50%">
          <stop offset="0.8" stopColor="#8cc8ff" stopOpacity="0" />
          <stop offset="1" stopColor="#8cc8ff" stopOpacity="0.35" />
        </radialGradient>
        <clipPath id="loading-ball">
          <circle cx="40" cy="40" r="30" />
        </clipPath>
      </defs>
      <circle cx="40" cy="40" r="33" className={styles.halo} />
      <circle cx="40" cy="40" r="30" fill="url(#loading-sea)" />
      <g clipPath="url(#loading-ball)">
        <g className={styles.surface} fill="#55a557">
          <Continents />
          <g transform={`translate(${STRIP_WIDTH} 0)`}>
            <Continents />
          </g>
        </g>
        <rect x="10" y="10" width="60" height="60" fill="url(#loading-night)" />
        <circle cx="40" cy="40" r="30" fill="url(#loading-limb)" />
      </g>
    </svg>
  )
}

export interface LoadingScreenProps {
  /** 0..1 across everything that gates first paint (`firstScene.ts`'s `loadingProgress`). */
  progress: number
}

export function LoadingScreen({ progress }: LoadingScreenProps) {
  const clamped = Math.min(1, Math.max(0, progress))
  return (
    <main className={styles.screen} data-testid="loading-screen">
      <LoadingGlobe />
      <p className={styles.title}>Earthlapse</p>
      <div
        className={styles.track}
        role="progressbar"
        aria-label="Loading"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped * 100)}
      >
        <div className={styles.fill} style={{ transform: `scaleX(${clamped})` }} data-testid="loading-progress" />
      </div>
    </main>
  )
}
