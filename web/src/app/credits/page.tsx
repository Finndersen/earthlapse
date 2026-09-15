'use client'

/**
 * `/credits` — kept as a direct/bookmarkable link (nothing in the app links here any more; the
 * in-experience "About & credits" panel, `ShellLayout`'s `Panel`, is the primary way to reach
 * this content now — see the ADR-012 amendment and VISUAL_SPEC §9 for why). Renders the same
 * `CreditsList` the panel does, in its own full-page frame with a way back to the timeline.
 */

import { EventTagLegend } from '@/events'
import { CreditsList } from '@/shell'

import styles from './credits.module.css'

export default function CreditsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        <a className={styles.back} href="/">
          ← Back to the timeline
        </a>
        <h1 className={styles.title}>Credits</h1>
        <CreditsList eventLegend={<EventTagLegend />} />
      </div>
    </main>
  )
}
