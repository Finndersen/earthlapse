'use client'

/**
 * `<EventFeed>` — the roadmap's "non-intrusive playback pop-up cards" / "event card
 * (description + citation)" (approved-roadmap-2026-09), surfacing events as the playhead
 * reaches them instead of requiring a hover over the timeline.
 *
 * Prop-driven and pure in `t` (`select.ts`'s `selectFeedEvents`, `presentation.ts`'s card
 * emphasis/opacity) plus the OS reduced-motion preference, a narrow-viewport check for the
 * compact strip and the slot's own measured size — the same "pure in `t`, plus presentational
 * chrome" split every other package in this app follows (`SceneView`, `AncestorPortrait`). No
 * timer decides what shows or what is highlighted: revisiting the same `t` from either scrub
 * direction, or at any playback speed, reproduces the exact same cards and the same emphasis.
 *
 * Renders no visible content when there is nothing to show, matching the package's chrome-less
 * convention (an empty feed is not a panel with no content) — but keeps its own measuring
 * wrapper mounted even then: `selectFeedEvents` needs the wrapper's real pixel width, and that
 * width can only be measured once the wrapper exists, so hiding the wrapper *because* there is
 * nothing to show would make there permanently be nothing to show (`width` stuck at 0, the
 * `trackWidthPx <= 0` guard in `select.ts` never clearing). The wrapper fills its slot's height
 * (so that height can be measured for `feedCardCapacity`) but carries no padding, border, text
 * or pointer target of its own, so an empty one occupies no visible or clickable space.
 *
 * A card no longer expands in place (W-followup item 12): clicking/tapping/Enter-ing one calls
 * `onEventActivate` and the caller (`Experience.tsx`) owns what happens next — opening
 * `EventDetailPanel`, pausing playback if it was running. This component never scrubs `t` on its
 * own any more either; only the detail panel's own "Show on timeline" does that, so simply
 * opening a card to read it can no longer move the playhead out from under a reader.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

import { usePrefersReducedMotion } from '@/timeline'
import type { GeoTime, TimeScale, TimelineEvent } from '@/types/layer'

import { formatEventDate } from '../placement'
import {
  FEED_CARD_GAP_PX,
  FEED_CARD_HEIGHT_PX,
  FEED_OVERFLOW_LINE_PX,
  FEED_STRIP_HEIGHT_PX,
  feedCardCapacity,
  feedCardEmphases,
  feedCardInsetPx,
  feedCardOffsetPx,
  feedCardOpacity,
  feedStripCapacity,
} from '../presentation'
import { DEFAULT_MAX_VISIBLE, selectFeedEvents, type FeedEntry } from '../select'
import { EVENT_TAG_PALETTE, primaryTag } from '../tagPalette'
import { useElementSize } from '../useElementSize'
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
  '--feed-overflow-line': `${FEED_OVERFLOW_LINE_PX}px`,
  '--feed-strip-height': `${FEED_STRIP_HEIGHT_PX}px`,
} as CSSProperties

export interface EventFeedProps {
  t: GeoTime
  /** The scale the pixel lookback is measured on. `Experience` passes the full-domain symlog
   *  scale, not the timeline's section-windowed one, so selecting a short era section never
   *  shrinks the lookback to a few decades (ADR-024). */
  scale: TimeScale
  events: readonly TimelineEvent[]
  /** A card was clicked/tapped/Enter-ed — the caller opens `EventDetailPanel` for it (and, per
   *  W-followup item 12, pauses playback if it was running). This component neither opens a
   *  panel nor scrubs `t` itself; it only reports the activation. */
  onEventActivate: (event: TimelineEvent) => void
  /** The ids currently showing as cards, reported whenever that set changes (not per frame). The
   *  globe's human-civilisation layer pulses an arrival's arc or marker while its own card is on
   *  screen, so the two read as the same subject; reporting the selection rather than
   *  re-deriving it there is what keeps one selection rule (`selectFeedEvents`) in the app. */
  onVisibleEventsChange?: (eventIds: readonly string[]) => void
  /** The card the pointer is over, or `null`. Drives the stronger of the globe's two sympathetic
   *  pulses. */
  onCardHoverChange?: (eventId: string | null) => void
  className?: string
}

export function EventFeed({
  t,
  scale,
  events,
  onEventActivate,
  onVisibleEventsChange,
  onCardHoverChange,
  className,
}: EventFeedProps) {
  const [containerRef, size] = useElementSize<HTMLDivElement>()
  const compact = useIsCompactViewport()
  const reducedMotion = usePrefersReducedMotion()

  const maxVisible = compact ? feedStripCapacity(size.height) : feedCardCapacity(size.height, DEFAULT_MAX_VISIBLE)
  const selection = useMemo(
    () => selectFeedEvents(events, t, scale, size.width, { maxVisible }),
    [events, t, scale, size.width, maxVisible],
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
    setAnnouncement(`${freshest.event.label}, ${formatEventDate(freshest.event)}`)
  }, [selection.visible])

  // Keyed on the joined ids, not the array: `selectFeedEvents` returns a fresh array every frame
  // of playback, but the *set* only changes when the playhead actually reaches or drops an event.
  const visibleIds = selection.visible.map((entry) => entry.event.id)
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
      ref={containerRef}
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
                onActivate={() => onEventActivate(entry.event)}
                onHoverChange={onCardHoverChange}
              />
            ))}
          </ul>
          {/* Always rendered (empty when nothing overflows) so the stack doesn't hop by a line
              each time a dense stretch starts or stops overflowing, and a receding bottom card's
              drift lands in this reserved space instead of spilling into a scrollbar. */}
          {selection.overflowCount > 0 ? (
            <p className={styles.overflow} data-testid="event-feed-overflow">
              +{selection.overflowCount} more
            </p>
          ) : (
            <p className={styles.overflow} aria-hidden="true" />
          )}
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
   *  itself carries no open/closed state of its own any more (W-followup item 12). */
  onActivate: () => void
  /** Reported on pointer enter/leave and on focus/blur, so a keyboard user gets the same globe
   *  highlight a mouse user does. */
  onHoverChange: ((eventId: string | null) => void) | undefined
}

function EventFeedCard({ entry, emphasis, reducedMotion, onActivate, onHoverChange }: EventFeedCardProps) {
  const { event, distanceFraction } = entry
  const offsetPx = reducedMotion ? 0 : feedCardOffsetPx(distanceFraction)
  const insetPx = reducedMotion ? 0 : feedCardInsetPx(emphasis)
  const tag = primaryTag(event)
  const swatch = tag ? EVENT_TAG_PALETTE[tag] : null

  // The emphasis highlight (accent bar, tinted wash, title glow) is static styling keyed off
  // `--feed-emphasis`, so it survives reduced motion; only the movement (drift, inset, the
  // arrival slide-in) is dropped there.
  const cardStyle = {
    opacity: feedCardOpacity(distanceFraction),
    transform: offsetPx === 0 ? undefined : `translateY(${offsetPx}px)`,
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
          <span className={styles.label}>{event.label}</span>
          <span className={styles.detail}>
            {/* Primary tag only (item 11) — `EventDetailPanel` lists every tag an event carries.
                Coloured and worded straight from `EVENT_TAG_PALETTE`, the one source both share. */}
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
