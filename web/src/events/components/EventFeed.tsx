'use client'

/**
 * `<EventFeed>` — the roadmap's "non-intrusive playback pop-up cards" / "event card
 * (description + citation)" (approved-roadmap-2026-09), surfacing events as the playhead
 * reaches them instead of requiring a hover over the timeline.
 *
 * Prop-driven and pure in `t` (`select.ts`'s `selectFeedEvents`) plus the OS reduced-motion
 * preference and a narrow-viewport check for the compact strip — the same "pure in `t`, plus
 * presentational chrome" split every other package in this app follows (`SceneView`,
 * `AncestorPortrait`). No timer decides what shows: revisiting the same `t` from either scrub
 * direction, or at any playback speed, reproduces the exact same cards.
 *
 * Renders no visible content when there is nothing to show, matching the package's chrome-less
 * convention (an empty feed is not a panel with no content) — but keeps its own measuring
 * wrapper mounted even then: `selectFeedEvents` needs the wrapper's real pixel width, and that
 * width can only be measured once the wrapper exists, so hiding the wrapper *because* there is
 * nothing to show would make there permanently be nothing to show (`widthPx` stuck at 0, the
 * `trackWidthPx <= 0` guard in `select.ts` never clearing). The wrapper carries no padding,
 * border or text of its own, so an empty one occupies no visible space regardless.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { usePrefersReducedMotion } from '@/timeline'
import type { GeoTime, TimeScale, TimelineEvent } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { formatEventDate, placementT } from '../placement'
import { sceneCaptionedEventIds } from '../sceneLink'
import { feedCardOffsetPx, feedCardOpacity, selectFeedEvents, type FeedEntry } from '../select'
import { EVENT_TAG_PALETTE, primaryTag } from '../tagPalette'
import { useElementWidth } from '../useElementWidth'
import { useIsCompactViewport } from '../useIsCompactViewport'
import styles from './EventFeed.module.css'

/** On a narrow viewport the feed collapses to a single card — the brief's "compact single-card
 *  strip above the timeline" — rather than its default stack. */
const COMPACT_MAX_VISIBLE = 1

/** Minimum wall-clock gap between aria-live announcements: fast playback through a dense
 *  stretch (the Holocene, or a cluster like the K-Pg trio) reaches several events a second,
 *  and announcing every one would spam a screen reader — "throttled during fast playback" in
 *  the brief. One announcement lands per window; the rest are silently skipped, not queued. */
const ANNOUNCE_THROTTLE_MS = 3000

export interface EventFeedProps {
  t: GeoTime
  /** The same animated `TimeScale` the timeline itself draws against, so "N displayed px"
   *  means the same thing here as it does on the track. */
  scale: TimeScale
  events: readonly TimelineEvent[]
  /** `Manifest.scenes`, for `Scene.events` exclusion (ADR-022) — omit only where no scene data
   *  exists yet (nothing is excluded). */
  scenes?: readonly Scene[]
  /** The existing scrub path (`useTimeStore`'s `setT`, threaded the same way `<Timeline>`'s
   *  own `onScrub` is): activating a card scrubs/selects that event on the timeline. */
  onScrub: (t: GeoTime) => void
  className?: string
}

export function EventFeed({ t, scale, events, scenes = [], onScrub, className }: EventFeedProps) {
  const [containerRef, widthPx] = useElementWidth<HTMLDivElement>()
  const compact = useIsCompactViewport()
  const reducedMotion = usePrefersReducedMotion()

  const excludedEventIds = useMemo(() => sceneCaptionedEventIds(scenes, t), [scenes, t])
  const selection = useMemo(
    () =>
      selectFeedEvents(events, t, scale, widthPx, {
        excludedEventIds,
        maxVisible: compact ? COMPACT_MAX_VISIBLE : undefined,
      }),
    [events, t, scale, widthPx, excludedEventIds, compact],
  )

  // The one card showing its full description + citation, if any. Cleared implicitly whenever
  // it ages out of `visible` (scrubbed past, or the excluding scene changed) — nothing re-opens
  // a stale id, since a card only renders expanded when its own id matches this state.
  const [expandedId, setExpandedId] = useState<string | null>(null)

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

  const handleActivate = (event: TimelineEvent): void => {
    setExpandedId((current) => (current === event.id ? null : event.id))
    onScrub(placementT(event))
  }

  const hasCards = selection.visible.length > 0

  return (
    <div ref={containerRef} className={[styles.feed, className].filter(Boolean).join(' ')} data-testid="event-feed">
      <p className={styles.liveRegion} aria-live="polite" role="status">
        {announcement}
      </p>
      {hasCards && (
        <>
          <ul
            className={styles.list}
            onKeyDown={(e) => {
              if (e.key !== 'Escape' || expandedId === null) return
              e.stopPropagation()
              setExpandedId(null)
            }}
          >
            {selection.visible.map((entry) => (
              <EventFeedCard
                key={entry.event.id}
                entry={entry}
                expanded={entry.event.id === expandedId}
                reducedMotion={reducedMotion}
                onActivate={() => handleActivate(entry.event)}
              />
            ))}
          </ul>
          {selection.overflowCount > 0 && (
            <p className={styles.overflow} data-testid="event-feed-overflow">
              +{selection.overflowCount} more
            </p>
          )}
        </>
      )}
    </div>
  )
}

interface EventFeedCardProps {
  entry: FeedEntry
  expanded: boolean
  reducedMotion: boolean
  onActivate: () => void
}

function EventFeedCard({ entry, expanded, reducedMotion, onActivate }: EventFeedCardProps) {
  const { event, distanceFraction } = entry
  const opacity = feedCardOpacity(distanceFraction)
  const offsetPx = reducedMotion ? 0 : feedCardOffsetPx(distanceFraction)
  const tag = primaryTag(event)
  const swatch = tag ? EVENT_TAG_PALETTE[tag] : null

  return (
    <li
      className={styles.card}
      style={{ opacity, transform: offsetPx === 0 ? undefined : `translateY(${offsetPx}px)` }}
    >
      <button
        type="button"
        className={styles.cardButton}
        aria-expanded={expanded}
        data-testid={`event-feed-card-${event.id}`}
        onClick={onActivate}
      >
        <span
          className={styles.chip}
          aria-hidden="true"
          title={swatch?.label}
          style={{
            background: swatch?.color ?? 'var(--hud-faint, rgba(239, 233, 220, 0.36))',
            boxShadow: swatch ? `0 0 6px ${swatch.color}` : 'none',
          }}
        />
        <span className={styles.body}>
          <span className={styles.headline}>
            <span className={`${styles.label} ${expanded ? styles.labelExpanded : ''}`}>{event.label}</span>
            <span className={styles.date}>{formatEventDate(event)}</span>
          </span>
          <span className={`${styles.description} ${expanded ? styles.descriptionExpanded : ''}`}>
            {event.description}
          </span>
          {expanded && <span className={styles.citation}>{event.citation}</span>}
        </span>
      </button>
    </li>
  )
}
