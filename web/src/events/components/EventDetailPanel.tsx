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
 *
 * An event carrying an `arrival` effect (ADR-032) also gets a "Route" section: first settlement or
 * migration, its best-estimate date, the span its arc is drawn travelling on the globe, the
 * earlier arrivals it continues, and coarse origin/destination coordinates labelled as the
 * schematic region centroids they are. The chain is derived on the globe side
 * (`arrivalChainFor`), so this package never imports `@/globe`.
 *
 * `members` (ADR-040) lists a digest card's whole cluster, freshest first — omitted, or a single
 * element, renders exactly as a lone event's card always has. A digest lists every member in
 * full rather than collapsing to the headline alone, since the point of opening it is to read
 * the events the card's "+k more" badge stood in for.
 */

import { useId } from 'react'

import { Panel } from '@/shell'
import { formatGeoTime, formatTimeRange } from '@/timeline'
import type { ArrivalGlobeEffect, GlobeEffectAnchor, TimelineEvent } from '@/types/layer'

import { formatEventDate } from '../placement'
import { EVENT_TAG_PALETTE } from '../tagPalette'
import styles from './EventDetailPanel.module.css'

export interface EventDetailPanelProps {
  event: TimelineEvent
  /** Every reached member of `event`'s cluster, freshest first (`event` is `members[0]`).
   *  Omitted, or fewer than two entries, is a plain single-event panel. */
  members?: readonly TimelineEvent[]
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
  /** The earlier arrivals an arrival event continues, nearest first and ending at the origin.
   *  Omitted, the Route section lists no chain. */
  arrivalChainFor?: (eventId: string) => readonly ArrivalChainLink[]
  /** Opens another event in this panel's place — a chain link in the Route section. Omitted,
   *  the chain is plain text. */
  onOpenEvent?: (eventId: string) => void
}

/** One earlier arrival in a route's chain. */
export interface ArrivalChainLink {
  id: string
  label: string
}

interface RouteProps {
  arrivalChainFor?: (eventId: string) => readonly ArrivalChainLink[]
  onOpenEvent?: (eventId: string) => void
}

export function EventDetailPanel({
  event,
  members,
  onClose,
  onShowOnTimeline,
  onOpenBrowser,
  arrivalChainFor,
  onOpenEvent,
}: EventDetailPanelProps) {
  const route: RouteProps = { arrivalChainFor, onOpenEvent }
  const digestMembers = members !== undefined && members.length > 1 ? members : null
  const label = digestMembers !== null ? `${event.label} +${digestMembers.length - 1} more` : event.label

  return (
    <Panel label={label} onClose={onClose} className={styles.panel}>
      {digestMembers !== null ? (
        <ul className={styles.memberList}>
          {digestMembers.map((member) => (
            <li key={member.id} className={styles.member}>
              <p className={styles.memberLabel}>{member.label}</p>
              <EventDetailBody event={member} route={route} />
            </li>
          ))}
        </ul>
      ) : (
        <EventDetailBody event={event} route={route} />
      )}

      <button type="button" className={styles.showOnTimeline} onClick={onShowOnTimeline}>
        Show on timeline
      </button>
      <button type="button" className={styles.allEvents} onClick={onOpenBrowser}>
        All events
      </button>
    </Panel>
  )
}

function EventDetailBody({ event, route }: { event: TimelineEvent; route: RouteProps }) {
  return (
    <>
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
      {event.effect?.kind === 'arrival' && (
        <RouteSection
          effect={event.effect}
          chain={route.arrivalChainFor?.(event.id) ?? []}
          onOpenEvent={route.onOpenEvent}
        />
      )}
      {event.citation && <p className={styles.citation}>{event.citation}</p>}
    </>
  )
}

const ARRIVAL_KIND_LABEL: Record<ArrivalGlobeEffect['arrivalKind'], string> = {
  peopling: 'First settlement',
  migration: 'Migration',
}

/** Whole degrees with a hemisphere letter — as coarse as the centroids themselves are. */
function formatAnchor({ lat, lon }: GlobeEffectAnchor): string {
  const latitude = `${Math.abs(Math.round(lat))}°${lat < 0 ? 'S' : 'N'}`
  const longitude = `${Math.abs(Math.round(lon))}°${lon < 0 ? 'W' : 'E'}`
  return `${latitude} ${longitude}`
}

interface RouteSectionProps {
  effect: ArrivalGlobeEffect
  chain: readonly ArrivalChainLink[]
  onOpenEvent?: (eventId: string) => void
}

function RouteSection({ effect, chain, onOpenEvent }: RouteSectionProps) {
  const headingId = useId()
  // The one window reaching the present (the parse-time contract on `ArrivalGlobeEffect`); its
  // `tMax` is where the arc starts travelling.
  const travelFrom = effect.windows.find((w) => w.tMin === 0)?.tMax ?? effect.established
  const origin = formatAnchor(effect.origin)
  const destination = formatAnchor(effect.destination)
  const singleRegion = origin === destination

  return (
    <section className={styles.route} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.routeHeading}>
        Route
      </h3>
      <dl className={styles.routeFacts}>
        <dt>Kind</dt>
        <dd>{ARRIVAL_KIND_LABEL[effect.arrivalKind]}</dd>
        <dt>Established</dt>
        <dd>{formatGeoTime(effect.established)}</dd>
        <dt>Shown travelling</dt>
        <dd>{formatTimeRange([effect.established, travelFrom])}</dd>
        {chain.length > 0 && (
          <>
            <dt>Continues</dt>
            <dd>
              <ol className={styles.routeChain}>
                {chain.map((link) => (
                  <li key={link.id}>
                    {onOpenEvent !== undefined ? (
                      <button type="button" className={styles.routeLink} onClick={() => onOpenEvent(link.id)}>
                        {link.label}
                      </button>
                    ) : (
                      link.label
                    )}
                  </li>
                ))}
              </ol>
            </dd>
          </>
        )}
        <dt>{singleRegion ? 'Region' : 'From → to'}</dt>
        <dd className={styles.routeCoords}>{singleRegion ? origin : `${origin} → ${destination}`}</dd>
      </dl>
      <p className={styles.routeNote}>
        Schematic region centroids, not a traced route. The chain links each arrival to the nearest
        earlier destination.
      </p>
    </section>
  )
}
