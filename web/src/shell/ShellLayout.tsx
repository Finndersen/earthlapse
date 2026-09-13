'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import styles from './ShellLayout.module.css'

export interface ShellLayoutProps {
  /** Top-left corner overlay: the independent paleogeographic globe (DESIGN §7). */
  globe: ReactNode
  /** Left column, below the globe: scalar layer sparklines (DESIGN §8, §10). */
  hud: ReactNode
  /** Right column, upper: the ancestor-at-`t` portrait/readout (DESIGN §10). */
  ancestor: ReactNode
  /** Right column, lower: the current scene's caption. */
  caption: ReactNode
  /** The central vignetted viewport: the generated still, breathing and dissolving. */
  scene: ReactNode
  /** Bottom dock: the warped timeline with scrub, play and speed controls. */
  timeline: ReactNode
  /** Bottom dock, below the timeline: the expandable full-width chart for the active layer. */
  chart: ReactNode
}

/**
 * The page frame (DESIGN §8): a muted, blurred surround holding the globe, HUD and
 * ancestor/caption columns around a bright, vignetted central viewport, with a timeline and
 * chart dock beneath. Every area is a plain slot — this component owns layout and chrome
 * only, never the content or data inside a slot.
 */
export function ShellLayout({ globe, hud, ancestor, caption, scene, timeline, chart }: ShellLayoutProps) {
  return (
    <div className={styles.shell}>
      <Link href="/credits" className={styles.creditsLink}>
        Credits
      </Link>
      <div className={styles.surround}>
        <div className={styles.column}>
          <div className={`${styles.slot} ${styles.globeSlot}`}>{globe}</div>
          <div className={`${styles.slot} ${styles.hudSlot}`}>
            <span className={styles.slotLabel}>Layers</span>
            {hud}
          </div>
        </div>

        <div className={styles.viewport}>
          <div className={styles.viewportInner}>{scene}</div>
          <div className={styles.vignette} />
          <p className={styles.note}>Artistic reconstruction — plausibility, not accuracy.</p>
        </div>

        <div className={styles.column}>
          <div className={`${styles.slot} ${styles.ancestorSlot}`}>
            <span className={styles.slotLabel}>Your ancestor</span>
            {ancestor}
          </div>
          <div className={`${styles.slot} ${styles.captionSlot}`}>
            <span className={styles.slotLabel}>Scene</span>
            {caption}
          </div>
        </div>
      </div>

      <div className={styles.dock}>
        <div className={styles.timelineRow}>{timeline}</div>
        <div className={styles.chartRow}>{chart}</div>
      </div>
    </div>
  )
}
