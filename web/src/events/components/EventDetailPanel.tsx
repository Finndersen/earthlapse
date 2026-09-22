'use client'

/**
 * The event detail popout, replacing the feed card's old in-place expand.
 * Built on `@/shell`'s shared `Panel` — the one deliberate cross-package import this package
 * makes (see `events/index.ts`'s own doc comment) rather than a second bespoke focus trap.
 *
 * Pure chrome around one `TimelineEvent`: the full label (as `Panel`'s own heading), its
 * date/range, every tag it carries with its `EVENT_TAG_PALETTE` colour (unlike a feed card,
 * which shows only the primary one), the full description and citation, a "Show on timeline"
 * action, and an "All events" affordance opening `EventBrowser` (the full, searchable list).
 * `Panel` itself owns the focus trap, Escape, focus restore, click-outside and the phone bottom
 * sheet; this component owns none of that and touches no playback state — `Experience.tsx`
 * pauses on open and resumes on close, and scrubs `t` on "Show on timeline", as a direct
 * consequence of the user's own click, not as something this component decides.
 */

import { Panel } from '@/shell'
import type { TimelineEvent } from '@/types/layer'

import { formatEventDate } from '../placement'
import { EVENT_TAG_PALETTE } from '../tagPalette'
import styles from './EventDetailPanel.module.css'

export interface EventDetailPanelProps {
  event: TimelineEvent
  onClose: () => void
  /** Scrubs the timeline to this event's placement and closes the panel — the only thing in this
   *  panel that moves `t`. Opening the panel itself never does (the event is already recent;
   *  that's why a card for it is showing). The caller
   *  (`Experience.tsx`) does not resume playback on this particular close, even if it had been
   *  playing before the panel opened, since doing so would immediately carry the playhead away
   *  from the place just asked for. */
  onShowOnTimeline: () => void
  /** Opens `EventBrowser`, the full searchable event list, scrolled to this event. Replaces this
   *  panel rather than layering over it — the caller owns that transition. */
  onOpenBrowser: () => void
}

export function EventDetailPanel({ event, onClose, onShowOnTimeline, onOpenBrowser }: EventDetailPanelProps) {
  return (
    <Panel label={event.label} onClose={onClose} className={styles.panel}>
      <p className={styles.date}>{formatEventDate(event)}</p>

      {event.tags && event.tags.length > 0 && (
        <ul className={styles.tags}>
          {event.tags.map((tag) => {
            const style = EVENT_TAG_PALETTE[tag]
            return (
              <li key={tag} className={styles.tag} style={{ color: style.color }}>
                <span aria-hidden="true" className={styles.tagDot} style={{ background: style.color }} />
                {style.label}
              </li>
            )
          })}
        </ul>
      )}

      <p className={styles.description}>{event.description}</p>
      {event.citation && <p className={styles.citation}>{event.citation}</p>}

      <button type="button" className={styles.showOnTimeline} onClick={onShowOnTimeline}>
        Show on timeline
      </button>
      <button type="button" className={styles.allEvents} onClick={onOpenBrowser}>
        All events
      </button>
    </Panel>
  )
}
