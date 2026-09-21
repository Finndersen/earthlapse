'use client'

/**
 * `<EventFeed>` — the roadmap's "non-intrusive playback pop-up cards" / "event card
 * (description + citation)" (approved-roadmap-2026-09), surfacing events as the playhead
 * reaches them instead of requiring a hover over the timeline.
 *
 * Prop-driven and pure in `t` (`select.ts`'s `selectFeedEvents`, `presentation.ts`'s card
 * emphasis/opacity) plus the OS reduced-motion preference and a narrow-viewport check for the
 * compact strip — the same "pure in `t`, plus presentational chrome" split every other package
 * in this app follows (`SceneView`, `AncestorPortrait`). No timer decides what shows or what is
 * highlighted: revisiting the same `t` from either scrub direction, or at any playback speed,
 * reproduces the exact same cards and the same emphasis.
 *
 * Renders no visible content when there is nothing to show, matching the package's chrome-less
 * convention (an empty feed is not a panel with no content) — but keeps its own wrapper mounted
 * even then, so the aria-live region persists across an empty-to-populated transition rather
 * than remounting and losing (or double-firing) an announcement.
 *
 * A card does not expand in place: clicking/tapping/Enter-ing one calls `onEventActivate` and the
 * caller (`Experience.tsx`) owns what happens next — opening `EventDetailPanel`, pausing playback
 * if it was running. This component never scrubs `t` on its own either; only the detail panel's
 * own "Show on timeline" does that, so opening a card to read it can't move the playhead out from
 * under a reader.
 *
 * A card renders one `select.ts` cluster (ADR-040), not one event: a single-member cluster looks
 * exactly as a lone event card always has, and a multi-member one adds a small "+k more" badge
 * next to its headline. `onEventActivate`'s second argument carries every reached member, freshest
 * first, so a caller wiring up `EventDetailPanel` can list all of them, not just the headline.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { HUD_READOUT_THROTTLE_MS, useThrottledValue } from '@/lib/useThrottledValue'
import { usePrefersReducedMotion } from '@/timeline'
import type { GeoTime, TimelineEvent } from '@/types/layer'

import { formatEventDate } from '../placement'
import {
  FEED_CARD_GAP_PX,
  FEED_CARD_HEIGHT_PX,
  FEED_STRIP_HEIGHT_PX,
  feedCardEmphases,
  feedCardInsetPx,
  feedCardOpacity,
} from '../presentation'
import { DEFAULT_MAX_VISIBLE, selectFeedEvents, type FeedEntry } from '../select'
import { EVENT_TAG_PALETTE, primaryTag } from '../tagPalette'
import { useIsCompactViewport } from '../useIsCompactViewport'
import styles from './EventFeed.module.css'

/** Minimum wall-clock gap between aria-live announcements: fast playback through a dense
 *  stretch (the Holocene, or a cluster like the K-Pg trio) reaches several events a second,
 *  and announcing every one would spam a screen reader — "throttled during fast playback" in
 *  the brief. One announcement lands per window; the rest are silently skipped, not queued. */
const ANNOUNCE_THROTTLE_MS = 3000

/** Accent for an event with no tag (published before ADR-022's tags existed). */
const UNTAGGED_ACCENT = 'rgba(239, 233, 220, 0.62)'

/** `presentation.ts`'s geometry, handed to the stylesheet so the two can't disagree. */
const GEOMETRY_STYLE = {
  '--feed-card-height': `${FEED_CARD_HEIGHT_PX}px`,
  '--feed-card-gap': `${FEED_CARD_GAP_PX}px`,
  '--feed-strip-height': `${FEED_STRIP_HEIGHT_PX}px`,
} as CSSProperties

export interface EventFeedProps {
  t: GeoTime
  events: readonly TimelineEvent[]
  /** A card was clicked/tapped/Enter-ed — the caller opens `EventDetailPanel` for it (and pauses
   *  playback if it was running). This component neither opens a panel nor scrubs `t` itself; it
   *  only reports the activation. `members` is the activated card's whole cluster, freshest
   *  first, `event` always `members[0]` — a lone event's own singleton cluster for a
   *  single-member card. */
  onEventActivate: (event: TimelineEvent, members: readonly TimelineEvent[]) => void
  /** The ids of every event currently showing — including a digest card's non-headline members,
   *  not just each card's headline — reported whenever that set changes (not per frame). The
   *  globe's human-civilisation layer pulses an arrival's arc or marker while its own card is on
   *  screen, so the two read as the same subject; reporting the selection rather than
   *  re-deriving it there is what keeps one selection rule (`selectFeedEvents`) in the app. */
  onVisibleEventsChange?: (eventIds: readonly string[]) => void
  /** The card the pointer is over, or `null`. Drives the stronger of the globe's two sympathetic
   *  pulses. */
  onCardHoverChange?: (eventId: string | null) => void
  className?: string
}

export function EventFeed({ t, events, onEventActivate, onVisibleEventsChange, onCardHoverChange, className }: EventFeedProps) {
  const compact = useIsCompactViewport()
  const reducedMotion = usePrefersReducedMotion()

  const maxVisible = compact ? 1 : DEFAULT_MAX_VISIBLE
  // Every card's opacity is a function of `t`, so an unthrottled feed restyles itself on every
  // frame of playback. Over the expanded globe's `backdrop-filter` backdrop that churn is
  // disproportionately expensive, and at this size it is imperceptible either way.
  const throttledT = useThrottledValue(t, HUD_READOUT_THROTTLE_MS)
  const selection = useMemo(
    () => selectFeedEvents(events, throttledT, { maxVisible }),
    [events, throttledT, maxVisible],
  )
  const emphases = useMemo(() => feedCardEmphases(selection.visible), [selection.visible])

  const [announcement, setAnnouncement] = useState('')
  const lastAnnouncedIdRef = useRef<string | null>(null)
  const lastAnnouncedAtRef = useRef(0)
  useEffect(() => {
    const freshest = selection.visible[0]
    if (freshest === undefined) return
    if (freshest.event.id === lastAnnouncedIdRef.current) return
    const now = Date.now()
    if (now - lastAnnouncedAtRef.current < ANNOUNCE_THROTTLE_MS) return
    lastAnnouncedIdRef.current = freshest.event.id
    lastAnnouncedAtRef.current = now
    const extraCount = freshest.members.length - 1
    const suffix = extraCount > 0 ? `, and ${extraCount} more` : ''
    setAnnouncement(`${freshest.event.label}, ${formatEventDate(freshest.event)}${suffix}`)
  }, [selection.visible])

  // Every reached member of every visible cluster, not just each card's headline — a digest
  // card's non-headline members are still on screen (inside its "+k more"), so the globe's
  // sympathetic pulse should track them too. Keyed on the joined ids, not the array:
  // `selectFeedEvents` returns a fresh array every frame of playback, but the *set* only changes
  // when the playhead actually reaches or drops an event.
  const visibleIds = selection.visible.flatMap((entry) => entry.members.map((member) => member.id))
  const visibleIdsKey = visibleIds.join('\n')
  const visibleIdsRef = useRef(visibleIds)
  visibleIdsRef.current = visibleIds
  const onVisibleEventsChangeRef = useRef(onVisibleEventsChange)
  onVisibleEventsChangeRef.current = onVisibleEventsChange
  useEffect(() => {
    onVisibleEventsChangeRef.current?.(visibleIdsRef.current)
  }, [visibleIdsKey])

  const hasCards = selection.visible.length > 0

  return (
    <div
      className={[styles.feed, className].filter(Boolean).join(' ')}
      style={GEOMETRY_STYLE}
      data-testid="event-feed"
    >
      <p className={styles.liveRegion} aria-live="polite" role="status">
        {announcement}
      </p>
      {hasCards && (
        <div className={styles.scroller}>
          <ul className={styles.list}>
            {selection.visible.map((entry, rank) => (
              <EventFeedCard
                key={entry.event.id}
                entry={entry}
                emphasis={emphases[rank] ?? 0}
                reducedMotion={reducedMotion}
                onActivate={() => onEventActivate(entry.event, entry.members)}
                onHoverChange={onCardHoverChange}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

interface EventFeedCardProps {
  entry: FeedEntry
  /** `feedCardEmphases` for this card: 1 as the playhead reaches it, 0 once settled. */
  emphasis: number
  reducedMotion: boolean
  /** Clicking/tapping/Enter-ing the card — opens `EventDetailPanel` one level up. The card
   *  itself carries no open/closed state of its own. */
  onActivate: () => void
  /** Reported on pointer enter/leave and on focus/blur, so a keyboard user gets the same globe
   *  highlight a mouse user does. */
  onHoverChange: ((eventId: string | null) => void) | undefined
}

function EventFeedCard({ entry, emphasis, reducedMotion, onActivate, onHoverChange }: EventFeedCardProps) {
  const { event, distanceFraction, members } = entry
  const insetPx = reducedMotion ? 0 : feedCardInsetPx(emphasis)
  const tag = primaryTag(event)
  const swatch = tag ? EVENT_TAG_PALETTE[tag] : null
  const extraCount = members.length - 1

  // The emphasis highlight (accent bar, tinted wash, title glow) is static styling keyed off
  // `--feed-emphasis`, so it survives reduced motion; only the movement (inset, the arrival
  // slide-in) is dropped there.
  const cardStyle = {
    opacity: feedCardOpacity(distanceFraction),
    '--feed-emphasis': emphasis,
    '--feed-accent': swatch?.color ?? UNTAGGED_ACCENT,
  } as CSSProperties

  return (
    <li
      className={[styles.card, reducedMotion ? '' : styles.cardAnimated].filter(Boolean).join(' ')}
      style={cardStyle}
      data-emphasised={emphasis > 0}
      data-testid={`event-feed-item-${event.id}`}
      onPointerEnter={() => onHoverChange?.(event.id)}
      onPointerLeave={() => onHoverChange?.(null)}
      onFocus={() => onHoverChange?.(event.id)}
      onBlur={() => onHoverChange?.(null)}
    >
      <button
        type="button"
        className={styles.cardButton}
        aria-haspopup="dialog"
        data-testid={`event-feed-card-${event.id}`}
        onClick={onActivate}
      >
        <span className={styles.chip} aria-hidden="true" title={swatch?.label} />
        <span className={styles.body} style={insetPx === 0 ? undefined : { transform: `translateX(${insetPx}px)` }}>
          <span className={styles.label}>
            <span className={styles.labelText}>{event.label}</span>
            {/* A digest card's own "+k more" affordance (ADR-040) — the rest of its cluster's
                reached members, listed in full in the detail panel this card opens. */}
            {extraCount > 0 && (
              <span className={styles.moreBadge} data-testid={`event-feed-more-${event.id}`}>
                +{extraCount} more
              </span>
            )}
          </span>
          <span className={styles.detail}>
            {/* Primary tag only — `EventDetailPanel` lists every tag an event carries. Coloured
                and worded straight from `EVENT_TAG_PALETTE`, the one source both share. */}
            {swatch && (
              <span className={styles.tag} style={{ color: swatch.color }}>
                {swatch.label}
              </span>
            )}
            <span className={styles.date}>{formatEventDate(event)}</span>{' '}
            <span className={styles.description}>{event.description}</span>
          </span>
        </span>
      </button>
    </li>
  )
}
