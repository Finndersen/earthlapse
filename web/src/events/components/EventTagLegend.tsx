/**
 * The compact "what the event colours mean" key (W-followup item 11): six dots and names, read
 * straight from `EVENT_TAG_PALETTE` so it can never drift from what a feed card's primary-tag
 * label or `EventDetailPanel`'s full tag list actually shows. Pure presentation, no state of its
 * own — `CreditsList` mounts it once, inside the About & credits panel, rather than this package
 * adding a second permanent trigger of its own to the feed's already tight vertical budget
 * (DESIGN.md § Event feed: "the most the slot ... fits"). The timeline doesn't render event
 * markers by tag colour yet (ADR-022 defers that), so nothing here claims to key the track too.
 */

import type { EventTag } from '@/types/layer'

import { EVENT_TAG_PALETTE } from '../tagPalette'
import styles from './EventTagLegend.module.css'

export function EventTagLegend() {
  return (
    <ul className={styles.list}>
      {(Object.keys(EVENT_TAG_PALETTE) as EventTag[]).map((tag) => {
        const style = EVENT_TAG_PALETTE[tag]
        return (
          <li key={tag} className={styles.item}>
            <span aria-hidden="true" className={styles.dot} style={{ background: style.color }} />
            {style.label}
          </li>
        )
      })}
    </ul>
  )
}
