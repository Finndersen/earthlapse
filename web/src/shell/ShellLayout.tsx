'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import styles from './ShellLayout.module.css'

export interface ShellLayoutProps {
  /** Full-window backdrop: the generated still, breathing and dissolving. */
  scene: ReactNode
  /** Top-left floating orb: the independent paleogeographic globe (DESIGN §7). */
  globe: ReactNode
  /** The globe's current regime/effect caption (docs/GLOBE.md §7), or `''` for none, sourced
   *  from `Globe`'s `onCaptionChange` — `Globe` itself never draws this, in either state, so it
   *  never overlaps the orb's own picture (the user-reported "label on top of the globe"
   *  issue). Two places, depending on `globeExpanded`:
   *  - minimised: replaces the "Paleogeography" label under the orb while non-empty, falling
   *    back to it otherwise, in a single-line slot whose height never changes as the caption
   *    appears/disappears;
   *  - expanded: shown in the `caption`/`chart` stage above the timeline — the scene caption's
   *    own spot, empty while the globe is expanded (below) — rather than placed by `Globe`'s
   *    own fullscreen backdrop, which has no way to know where the timeline's playhead label
   *    actually sits and so can't reliably avoid it. */
  globeCaption: string
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
  /** Idle calm: quiets the periphery (readouts, credits) while the caption, title and timeline
   *  stay fully visible. The globe and ancestor never fade for idle calm — both can be
   *  animating (globe rotation/effects, ancestor portrait) and are meant to be watched. */
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
  globeCaption,
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
        <div className={styles.globe}>
          <div className={styles.orb}>{globe}</div>
          {/* While expanded, `.expandedGlobeCaption` announces the caption; one live region at a time. */}
          <span className={`${styles.label} ${styles.globeLabel}`} aria-live={globeExpanded ? undefined : 'polite'}>
            {globeCaption !== '' ? globeCaption : 'Paleogeography'}
          </span>
        </div>

        <div className={`${styles.readouts} ${styles.peripheral}`}>{readouts}</div>

        <header className={styles.title}>
          {title}
          {badge}
        </header>

        <div className={styles.ancestor}>
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
            <div className={styles.expandedGlobeCaption} aria-live={globeExpanded ? 'polite' : undefined}>
              {globeCaption}
            </div>
          </div>
          <p className={styles.note}>Artistic reconstruction — plausibility, not accuracy.</p>
          <div className={styles.timeline}>{timeline}</div>
        </div>
      </div>
    </div>
  )
}
