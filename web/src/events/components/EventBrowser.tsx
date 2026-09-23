'use client'

/**
 * "All events": the full event list, searchable and tag-filterable, opened from
 * `EventDetailPanel`'s own "All events" affordance or the desktop `/` shortcut.
 *
 * Lives on `EventDock`, the docked non-modal surface it shares with `EventDetailPanel`, so the
 * timeline below stays visible and scrubbable while it is open.
 *
 * Search and tag filtering are `browse.ts`'s pure `browseEvents`. The list highlight tracks `t`:
 * `nearestBrowseEventIndex` recomputes whenever `t` or the filtered results change, and the
 * highlighted row is scrolled into view — arrow keys and hover can move the highlight further
 * without touching `t`, but only Enter/click on a row calls `onActivate`, which is the *only*
 * thing that ever sets `t`. That one-way rule is what keeps scrub-driven scrolling and
 * selection-driven seeking from feeding back into each other.
 *
 * Rows are grouped under sticky era/section headers (`browseGroupSection`) — plain CSS
 * `position: sticky` inside the list's own scroll container, no virtualisation: at the scale of
 * this app's whole event set (a few hundred rows), a native scrolling list is cheap enough that
 * virtualising it would only add complexity for no measurable benefit.
 *
 * A vertical section rail runs down the list's own right edge (`rail.ts`'s pure
 * `buildRailEntries`/`railEntryAtFraction`), like a phone contacts app's A-Z index: press or drag
 * it and the list jumps to that section, with a large bubble naming the section while dragging.
 * It only ever scrolls the list — never `t` — and is a **pointer convenience**, not a second
 * keyboard path: the sticky headers plus arrow-key navigation the list already has are the
 * keyboard-accessible way to move by section, so the rail itself isn't in the tab order.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import type { EventTag, GeoTime, TimelineEvent } from '@/types/layer'

import { browseEvents, browseGroupSection, nearestBrowseEventIndex, type BrowseEventsFilters } from '../browse'
import { formatEventDate, placementT } from '../placement'
import { buildRailEntries, declutterRailLabels, railEntryAtFraction } from '../rail'
import { EVENT_TAG_PALETTE } from '../tagPalette'
import styles from './EventBrowser.module.css'
import { EventDock } from './EventDock'

export interface EventBrowserProps {
  events: readonly TimelineEvent[]
  /** The live playhead — drives which row is highlighted as "nearest", never set by this
   *  component itself (see this file's own doc comment on the one-way sync rule). */
  t: GeoTime
  onClose: () => void
  /** A row was clicked, tapped or Enter-ed — the caller jumps `t` to it and shows its detail
   *  card, closing this browser. The only thing in this component that ever changes `t`. */
  onActivate: (event: TimelineEvent) => void
  /** The search and tag selection to open with — how the caller brings a viewer back to the list
   *  they left. Omitted, it opens unfiltered. */
  initialFilters?: BrowseEventsFilters
  /** Reports every change to the search or tag selection, for the caller to hand back later. */
  onFiltersChange?: (filters: BrowseEventsFilters) => void
}

const ALL_TAGS = Object.keys(EVENT_TAG_PALETTE) as EventTag[]

function rowId(eventId: string): string {
  return `event-browser-row-${eventId}`
}

export function EventBrowser({ events, t, onClose, onActivate, initialFilters, onFiltersChange }: EventBrowserProps) {
  const [query, setQuery] = useState(initialFilters?.query ?? '')
  const [activeTags, setActiveTags] = useState<EventTag[]>(() => [...(initialFilters?.tags ?? [])])
  const [activeIndex, setActiveIndex] = useState(0)
  const [railDragLabel, setRailDragLabel] = useState<string | null>(null)
  // Tracked separately from `hasPointerCapture` (not implemented in every test environment, and
  // the drag bubble needs this as render state regardless).
  const [railDragging, setRailDragging] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const railResizeObserverRef = useRef<ResizeObserver | null>(null)
  const [railHeight, setRailHeight] = useState(0)

  // A callback ref rather than a `useEffect` on `railRef`: the rail div mounts and unmounts as
  // `railEntries` goes empty/non-empty (a query with no matches), and an effect with an empty
  // dependency array would never re-observe a remounted node.
  const setRailNode = useCallback((el: HTMLDivElement | null) => {
    railRef.current = el
    railResizeObserverRef.current?.disconnect()
    railResizeObserverRef.current = null
    if (el === null) return
    setRailHeight(el.getBoundingClientRect().height)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setRailHeight(entry.contentRect.height)
    })
    observer.observe(el)
    railResizeObserverRef.current = observer
  }, [])

  const results = useMemo(() => browseEvents(events, { query, tags: activeTags }), [events, query, activeTags])
  useEffect(() => {
    onFiltersChange?.({ query, tags: activeTags })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, activeTags])
  const railEntries = useMemo(() => buildRailEntries(results), [results])
  // Which entries' text actually gets drawn — deep-time sections can pack several entries into a
  // few px of the rail (`rail.ts`'s own doc comment); every entry still gets a tick regardless.
  const railPlacements = useMemo(() => declutterRailLabels(railEntries, railHeight), [railEntries, railHeight])

  // The highlight follows `t` — recentring on the nearest row whenever `t` moves (a scrub) or the
  // result set itself changes (a new query/tag narrows what "nearest" can even mean). Arrow keys
  // and hover move `activeIndex` directly, in between, without touching `t` or this effect.
  useEffect(() => {
    setActiveIndex(nearestBrowseEventIndex(results, t))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, t])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  // Opens on the search box with a mouse, where typing and the arrow keys start there; on a touch
  // screen focusing an input opens the on-screen keyboard over the list, so the dock takes focus.
  const [focusSearchOnOpen] = useState(
    () => typeof window.matchMedia !== 'function' || !window.matchMedia('(pointer: coarse)').matches,
  )

  function toggleTag(tag: EventTag): void {
    setActiveTags((tags) => (tags.includes(tag) ? tags.filter((t2) => t2 !== tag) : [...tags, tag]))
  }

  function handleKeyDown(e: ReactKeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      const event = results[activeIndex]
      if (event !== undefined) {
        e.preventDefault()
        onActivate(event)
      }
    }
  }

  // Scrolls the list to `entry`'s first row — never sets `t` (this file's own doc comment on the
  // one-way sync rule covers the rail too, not only arrow keys/hover).
  function jumpToRailEntry(entry: ReturnType<typeof railEntryAtFraction>): void {
    if (entry === null) return
    setActiveIndex(entry.startIndex)
    setRailDragLabel(entry.label)
    listRef.current?.querySelector<HTMLElement>(`[data-index="${entry.startIndex}"]`)?.scrollIntoView({ block: 'start' })
  }

  function railEntryAtClientY(clientY: number): ReturnType<typeof railEntryAtFraction> {
    const rect = railRef.current?.getBoundingClientRect()
    if (rect === undefined || rect.height === 0) return null
    return railEntryAtFraction(railEntries, (clientY - rect.top) / rect.height)
  }

  function handleRailPointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (railEntries.length === 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setRailDragging(true)
    jumpToRailEntry(railEntryAtClientY(e.clientY))
  }

  function handleRailPointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    if (!railDragging) return
    jumpToRailEntry(railEntryAtClientY(e.clientY))
  }

  function handleRailPointerUp(e: ReactPointerEvent<HTMLDivElement>): void {
    e.currentTarget.releasePointerCapture(e.pointerId)
    setRailDragging(false)
    setRailDragLabel(null)
  }

  const active = results[activeIndex]

  return (
    <EventDock
      title="All events"
      onClose={onClose}
      fit="fill"
      initialFocusRef={focusSearchOnOpen ? searchRef : undefined}
      testId="event-browser"
      header={
        <>
        <input
          ref={searchRef}
          type="text"
          className={styles.search}
          placeholder="Search events, places, eras…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={true}
          aria-controls="event-browser-list"
          aria-activedescendant={active ? rowId(active.id) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          data-testid="event-browser-search"
        />

        <ul className={styles.tagFilter} aria-label="Filter by tag">
          <li>
            <button
              type="button"
              className={styles.tagChip}
              data-active={activeTags.length === 0}
              aria-pressed={activeTags.length === 0}
              onClick={() => setActiveTags([])}
            >
              All
            </button>
          </li>
          {ALL_TAGS.map((tag) => {
            const style = EVENT_TAG_PALETTE[tag]
            const pressed = activeTags.includes(tag)
            return (
              <li key={tag}>
                <button
                  type="button"
                  className={styles.tagChip}
                  style={{ '--chip-color': style.color } as CSSProperties}
                  aria-pressed={pressed}
                  data-active={pressed}
                  onClick={() => toggleTag(tag)}
                >
                  <span aria-hidden="true" className={styles.tagDot} />
                  {style.label}
                </button>
              </li>
            )
          })}
        </ul>

        <p className={styles.count} aria-live="polite">
          {results.length} event{results.length === 1 ? '' : 's'}
        </p>
        </>
      }
    >

      <div className={styles.body}>
        <ul id="event-browser-list" ref={listRef} className={styles.list} role="listbox" aria-label="Events">
          {results.map((event, index) => {
            const tag = event.tags?.[0]
            const swatch = tag ? EVENT_TAG_PALETTE[tag] : null
            const section = browseGroupSection(placementT(event))
            const previousSection = index > 0 ? browseGroupSection(placementT(results[index - 1]!)) : null
            const showHeader = section.id !== previousSection?.id
            return (
              <li key={event.id} className={styles.row}>
                {showHeader && (
                  <p className={styles.sectionHeader} aria-hidden="true">
                    {section.label}
                  </p>
                )}
                <div
                  id={rowId(event.id)}
                  data-index={index}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={styles.rowInner}
                  data-active={index === activeIndex}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    className={styles.rowButton}
                    style={{ '--row-accent': swatch?.color ?? 'transparent' } as CSSProperties}
                    data-testid={`event-browser-row-button-${event.id}`}
                    onClick={() => onActivate(event)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span aria-hidden="true" className={styles.rowDot} />
                    <span className={styles.rowLabel}>{event.label}</span>
                    <span className={styles.rowDate}>{formatEventDate(event)}</span>
                  </button>
                </div>
              </li>
            )
          })}
          {results.length === 0 && <li className={styles.empty}>No events match.</li>}
        </ul>

        {railEntries.length > 0 && (
          <div
            ref={setRailNode}
            className={styles.rail}
            aria-hidden="true"
            data-testid="event-browser-rail"
            onPointerDown={handleRailPointerDown}
            onPointerMove={handleRailPointerMove}
            onPointerUp={handleRailPointerUp}
            onPointerCancel={handleRailPointerUp}
          >
            {railPlacements.map(({ entry, visible }) => (
              <span key={entry.sectionId} className={styles.railTick} style={{ top: `${entry.offset * 100}%` }}>
                {visible && (
                  <span className={styles.railLabel} data-testid="event-browser-rail-label">
                    {entry.abbreviation}
                  </span>
                )}
              </span>
            ))}
            {railDragging && railDragLabel !== null && <span className={styles.railBubble}>{railDragLabel}</span>}
          </div>
        )}
      </div>
    </EventDock>
  )
}
