'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import styles from './ShellLayout.module.css'

export interface ShellLayoutProps {
  /** Full-window backdrop: the generated still, breathing and dissolving. */
  scene: ReactNode
  /** Top-left floating orb: the independent paleogeographic globe (DESIGN §7). */
  globe: ReactNode
  /** Left edge, below the globe: scalar layer readouts and sparklines (DESIGN §8, §10). */
  readouts: ReactNode
  /** Top-centre: the current time and the eon/era it falls in. */
  title: ReactNode
  /** Beside the title: a small status tag (e.g. stub data), or nothing. */
  badge: ReactNode
  /** Top-right: the ancestor-at-`t` readout (DESIGN §10). */
  ancestor: ReactNode
  /** Bottom-centre, above the timeline: the scene caption as a subtitle. */
  caption: ReactNode
  /** The open layer chart, or `null`. It takes the caption's place above the timeline (the
   *  caption yields while it is open) so the two never overlap. */
  chart: ReactNode | null
  /** Bottom band: the warped timeline with scrub, play and speed controls. */
  timeline: ReactNode
  /** Idle calm: quiets the periphery (globe, readouts, ancestor, credits) while the caption,
   *  title and timeline stay fully visible. */
  calm: boolean
  /** The globe fills the lens: the title and timeline stay above its backdrop, still legible
   *  and scrubbable (watching the continents move is the point), while the rest recedes. */
  globeExpanded: boolean
}

/**
 * The page frame (DESIGN §8) as an "expedition viewing lens": the scene fills the window, a
 * vignette darkens it into near-black at the edges, and every piece of UI floats unboxed in
 * that darkened periphery. Every area is a plain slot — this component owns layout and
 * chrome only, never the content or data inside a slot.
 */
export function ShellLayout({
  scene,
  globe,
  readouts,
  title,
  badge,
  ancestor,
  caption,
  chart,
  timeline,
  calm,
  globeExpanded,
}: ShellLayoutProps) {
  return (
    <div className={styles.shell} data-calm={calm} data-chart-open={chart !== null} data-globe-expanded={globeExpanded}>
      <div className={styles.scene}>{scene}</div>
      <div className={styles.lens} aria-hidden="true" />

      <div className={styles.hud}>
        <div className={`${styles.globe} ${styles.peripheral}`}>
          <div className={styles.orb}>{globe}</div>
          <span className={styles.label}>Paleogeography</span>
        </div>

        <div className={`${styles.readouts} ${styles.peripheral}`}>{readouts}</div>

        <header className={styles.title}>
          {title}
          {badge}
        </header>

        <div className={`${styles.ancestor} ${styles.peripheral}`}>
          <span className={styles.label}>Your ancestor</span>
          {ancestor}
        </div>

        <Link href="/credits" className={`${styles.credits} ${styles.peripheral}`}>
          Credits
        </Link>

        <div className={styles.bottom}>
          <div className={styles.stage}>
            <div className={styles.caption}>{caption}</div>
            <div className={styles.chart}>{chart}</div>
          </div>
          <p className={styles.note}>Artistic reconstruction — plausibility, not accuracy.</p>
          <div className={styles.timeline}>{timeline}</div>
        </div>
      </div>
    </div>
  )
}
