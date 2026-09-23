/**
 * Pure search/filter for the "All events" browser: every event in time order, narrowed by a
 * free-text query and/or a tag selection. Distinct from `select.ts`'s `selectFeedEvents` — this
 * has no notion of a playhead or "recent"; it is the whole event set, always.
 *
 * The query matches a case-insensitive substring of the event's label, description, or the name
 * of any era/section its placement falls within (e.g. "Jurassic" matches an event placed there
 * even though no event field spells the word) — split on whitespace, every token required
 * (order-independent), which reads as "fuzzy" for the short queries a search box like this
 * actually gets without a scoring model.
 */

import { childSectionAt, sectionAt, sectionById, sectionContains, sectionPath, type TimelineSection } from '@/timeline'
import type { EventTag, GeoTime, TimelineEvent } from '@/types/layer'

import { placementT } from './placement'

/** Deep enough to reach the finest leaf section (a Holocene human-history subdivision) at any
 *  `t` — `sectionAt` itself stops early once there are no more children, so a depth past the
 *  deepest real tier is harmless. */
const SECTION_LOOKUP_DEPTH = 10

/** The deepest section `t` falls within — "Jurassic" rather than "Mesozoic", a human-history
 *  section rather than "Holocene" — for matching a search query against an era/section name. */
export function deepestSectionAt(t: GeoTime): TimelineSection {
  return sectionAt(t, SECTION_LOOKUP_DEPTH)
}

const HOLOCENE_SECTION = sectionById('holocene')

/** The section the browser groups a row under — its sticky list header, and the section a rail
 *  entry (`rail.ts`) points at. Two fixed tiers, not `deepestSectionAt`'s always-deepest leaf: the
 *  eon/era level (Archean, Paleozoic, Mesozoic, ...) everywhere except the Holocene, where the six
 *  human-history sections take over — coarse enough in deep time that the header/rail list stays
 *  a bounded handful of entries, granular enough in human history (where most events cluster) to
 *  actually be useful. */
export function browseGroupSection(t: GeoTime): TimelineSection {
  if (sectionContains(HOLOCENE_SECTION, t)) return childSectionAt('holocene', t) ?? HOLOCENE_SECTION
  return sectionAt(t, 1)
}

/** Every era/section name an event's placement falls within, root to leaf, space-joined for
 *  substring matching (e.g. "Earth Phanerozoic Mesozoic Jurassic"). */
function sectionSearchText(t: GeoTime): string {
  return sectionPath(deepestSectionAt(t).id)
    .map((section) => section.label)
    .join(' ')
}

function searchableText(event: TimelineEvent): string {
  return `${event.label} ${event.description} ${sectionSearchText(placementT(event))}`.toLowerCase()
}

function queryTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

export function matchesEventQuery(event: TimelineEvent, query: string): boolean {
  const tokens = queryTokens(query)
  if (tokens.length === 0) return true
  const haystack = searchableText(event)
  return tokens.every((token) => haystack.includes(token))
}

function matchesTags(event: TimelineEvent, tags: ReadonlySet<EventTag>): boolean {
  if (tags.size === 0) return true
  return (event.tags ?? []).some((tag) => tags.has(tag))
}

export interface BrowseEventsFilters {
  query: string
  /** Empty means no tag filter — every tag passes. */
  tags: readonly EventTag[]
}

/** Every event matching `filters`, oldest first (the order the timeline itself runs: `t` is
 *  years before present, so the oldest event has the largest `t`). */
export function browseEvents(events: readonly TimelineEvent[], filters: BrowseEventsFilters): TimelineEvent[] {
  const tagSet = new Set(filters.tags)
  return events
    .filter((event) => matchesTags(event, tagSet) && matchesEventQuery(event, filters.query))
    .sort((a, b) => placementT(b) - placementT(a))
}

/** The index of `events`'s member placed closest to `t` — how the browser keeps its list
 *  highlight following the timeline as it scrubs. `-1` for an empty list. A plain linear scan:
 *  the browser's whole list tops out around a few hundred events, nowhere near where a smarter
 *  search over the already-sorted array would pay for its own complexity. */
export function nearestBrowseEventIndex(events: readonly TimelineEvent[], t: GeoTime): number {
  let bestIndex = -1
  let bestDelta = Infinity
  for (let i = 0; i < events.length; i++) {
    const delta = Math.abs(placementT(events[i]!) - t)
    if (delta < bestDelta) {
      bestDelta = delta
      bestIndex = i
    }
  }
  return bestIndex
}

/** Which way to step from an event: `'older'` or `'newer'` along the browser's time order. */
export type EventStep = 'older' | 'newer'

/** The event one step `direction` of `eventId` in `browseEvents`' unfiltered time order, or
 *  `null` at either end (or for an id not in `events`). */
export function adjacentEvent(
  events: readonly TimelineEvent[],
  eventId: string,
  direction: EventStep,
): TimelineEvent | null {
  const ordered = browseEvents(events, { query: '', tags: [] })
  const index = ordered.findIndex((event) => event.id === eventId)
  if (index === -1) return null
  return ordered[index + (direction === 'newer' ? 1 : -1)] ?? null
}
