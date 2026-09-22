'use client'

/**
 * "All events": the full event list, searchable and tag-filterable, opened from
 * `EventDetailPanel`'s own "All events" affordance or the desktop `/` shortcut.
 *
 * Deliberately **not** built on `shell/Panel` — that primitive is modal (a full-viewport
 * backdrop, a focus trap), and this overlay has to leave the timeline underneath it visible and
 * scrubbable. Instead it docks itself above the timeline (`useTimelineBottomInset`
 * measures the real gap, on both desktop and a phone sheet) with no backdrop at all: nothing
 * outside its own box is inert. Escape closes it via its own `window` listener, the same pattern
 * `LayerChart`/the expanded globe already use for the same reason (`timeline/keyboard.ts`'s own
 * doc comment); Tab is left alone, so it can reach the timeline below rather than being trapped.
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
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import type { EventTag, GeoTime, TimelineEvent } from '@/types/layer'

import { browseEvents, browseGroupSection, nearestBrowseEventIndex } from '../browse'
import { formatEventDate, placementT } from '../placement'
import { buildRailEntries, railEntryAtFraction } from '../rail'
import { EVENT_TAG_PALETTE } from '../tagPalette'
import { useTimelineBottomInset } from '../useTimelineBottomInset'
import styles from './EventBrowser.module.css'

export interface EventBrowserProps {
  events: readonly TimelineEvent[]
  /** The live playhead — drives which row is highlighted as "nearest", never set by this
   *  component itself (see this file's own doc comment on the one-way sync rule). */
  t: GeoTime
  onClose: () => void
  /** A row was clicked, tapped or Enter-ed — the caller jumps `t` to it and shows its detail
   *  card, closing this browser. The only thing in this component that ever changes `t`. */
  onActivate: (event: TimelineEvent) => void
}

const ALL_TAGS = Object.keys(EVENT_TAG_PALETTE) as EventTag[]

function rowId(eventId: string): string {
  return `event-browser-row-${eventId}`
}

export function EventBrowser({ events, t, onClose, onActivate }: EventBrowserProps) {
  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState<EventTag[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [railDragLabel, setRailDragLabel] = useState<string | null>(null)
  // Tracked separately from `hasPointerCapture` (not implemented in every test environment, and
  // the drag bubble needs this as render state regardless).
  const [railDragging, setRailDragging] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const bottomInset = useTimelineBottomInset()

  const results = useMemo(() => browseEvents(events, { query, tags: activeTags }), [events, query, activeTags])
  const railEntries = useMemo(() => buildRailEntries(results), [results])

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

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

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
  const panelStyle = { '--browser-bottom-inset': `${bottomInset}px` } as CSSProperties

  return (
    <div className={styles.panel} style={panelStyle} role="dialog" aria-label="All events" data-testid="event-browser">
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>All events</h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            {'×'}
          </button>
        </div>

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
      </div>

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
            ref={railRef}
            className={styles.rail}
            aria-hidden="true"
            data-testid="event-browser-rail"
            onPointerDown={handleRailPointerDown}
            onPointerMove={handleRailPointerMove}
            onPointerUp={handleRailPointerUp}
            onPointerCancel={handleRailPointerUp}
          >
            {railEntries.map((entry) => (
              <span key={entry.sectionId} className={styles.railLabel} style={{ top: `${entry.offset * 100}%` }}>
                {entry.abbreviation}
              </span>
            ))}
            {railDragging && railDragLabel !== null && <span className={styles.railBubble}>{railDragLabel}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
