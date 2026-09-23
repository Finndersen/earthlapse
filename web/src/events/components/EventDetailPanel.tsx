'use client'

/**
 * The event detail card. Lives on `EventDock`, the docked, non-modal surface it shares with
 * `EventBrowser`, sized to its content and resting on the timeline, so the timeline stays visible
 * and scrubbable while it is open.
 *
 * Pure chrome around one `TimelineEvent`: the full label (as the dock's heading), its date/range,
 * every tag it carries with its `EVENT_TAG_PALETTE` colour (unlike a feed card, which shows only
 * the primary one), the full description and citation, a back button to `EventBrowser`, and a
 * footer stepping to the neighbouring events. It touches no playback state or `t`: `Experience.tsx` decides
 * what opening, stepping and closing do to them.
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
 *
 * Stepping (`onStep`) goes to the neighbouring event in the "All events" list's order: the footer's
 * Previous and Next buttons, or a swipe right (older) or left (newer) across the body.
 */

import { useId } from 'react'

import { formatGeoTime, formatTimeRange } from '@/timeline'
import type { ArrivalGlobeEffect, GlobeEffectAnchor, TimelineEvent } from '@/types/layer'

import type { EventStep } from '../browse'
import { formatEventDate } from '../placement'
import { EVENT_TAG_PALETTE } from '../tagPalette'
import { useSwipe } from '../useSwipe'
import { EventDock } from './EventDock'
import styles from './EventDetailPanel.module.css'

export interface EventDetailPanelProps {
  event: TimelineEvent
  /** Every reached member of `event`'s cluster, freshest first (`event` is `members[0]`).
   *  Omitted, or fewer than two entries, is a plain single-event panel. */
  members?: readonly TimelineEvent[]
  onClose: () => void
  /** The back button: opens `EventBrowser`, the full searchable event list, in this card's place. */
  onOpenBrowser: () => void
  /** The earlier arrivals an arrival event continues, nearest first and ending at the origin.
   *  Omitted, the Route section lists no chain. */
  arrivalChainFor?: (eventId: string) => readonly ArrivalChainLink[]
  /** Opens another event in this panel's place — a chain link in the Route section. Omitted,
   *  the chain is plain text. */
  onOpenEvent?: (eventId: string) => void
  /** The events either side of this one, `null` at an end. Omitted, there is no stepping. */
  neighbours?: Record<EventStep, TimelineEvent | null>
  /** Opens the neighbouring event in this card's place. */
  onStep?: (direction: EventStep) => void
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
  onOpenBrowser,
  arrivalChainFor,
  onOpenEvent,
  neighbours,
  onStep,
}: EventDetailPanelProps) {
  const step = (direction: EventStep): void => {
    if (neighbours?.[direction] && onStep) onStep(direction)
  }
  const swipe = useSwipe((direction) => step(direction === 'left' ? 'newer' : 'older'))
  const route: RouteProps = { arrivalChainFor, onOpenEvent }
  const digestMembers = members !== undefined && members.length > 1 ? members : null
  const label = digestMembers !== null ? `${event.label} +${digestMembers.length - 1} more` : event.label

  return (
    <EventDock
      title={label}
      onClose={onClose}
      fit="content"
      back={{ label: 'Back to all events', onBack: onOpenBrowser }}
      testId="event-detail"
    >
      <div className={styles.body} data-testid="event-detail-body" {...swipe}>
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
      </div>

      {neighbours && (
        <div className={styles.footer}>
          <StepButton direction="older" target={neighbours.older} onStep={step} />
          <StepButton direction="newer" target={neighbours.newer} onStep={step} />
        </div>
      )}
    </EventDock>
  )
}

function StepButton({
  direction,
  target,
  onStep,
}: {
  direction: EventStep
  target: TimelineEvent | null
  onStep: (direction: EventStep) => void
}) {
  const name = direction === 'older' ? 'Previous event' : 'Next event'
  return (
    <button
      type="button"
      className={styles.stepButton}
      data-direction={direction}
      aria-label={target ? `${name}: ${target.label}` : name}
      title={target?.label}
      disabled={target === null}
      onClick={() => onStep(direction)}
    >
      <span className={styles.stepHint}>{direction === 'older' ? '‹ Previous' : 'Next ›'}</span>
      {target && <span className={styles.stepTitle}>{target.label}</span>}
    </button>
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
