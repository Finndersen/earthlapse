import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatGeoTime, formatTimeRange } from '@/timeline'
import type { TimelineEvent } from '@/types/layer'

import { EVENT_TAG_PALETTE } from '../tagPalette'
import { EventDetailPanel } from './EventDetailPanel'

afterEach(() => {
  cleanup()
})

/** jsdom normalises an inline hex colour to `rgb(...)` on readback — same conversion in every
 *  test here that checks a palette colour landed on an element's `style`. */
function asRgb(hex: string): string {
  const [r, g, b] = hex
    .replace('#', '')
    .match(/.{2}/g)!
    .map((h) => parseInt(h, 16))
  return `rgb(${r}, ${g}, ${b})`
}

function event(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'k-pg-impact',
    label: 'The K-Pg impact',
    kind: 'moment',
    t: 66_000_000,
    tMin: 66_038_000,
    tMax: 65_962_000,
    tags: ['catastrophe', 'life'],
    importance: 1,
    description: 'A 10km asteroid strikes Chicxulub.',
    citation: 'Schulte et al., 2010.',
    ...overrides,
  }
}

describe('EventDetailPanel', () => {
  it('shows the full label, date, description and citation', () => {
    render(<EventDetailPanel event={event()} onClose={vi.fn()} onShowOnTimeline={vi.fn()} onOpenBrowser={vi.fn()} />)
    expect(screen.getByRole('dialog').textContent).toContain('The K-Pg impact')
    expect(screen.getByText('A 10km asteroid strikes Chicxulub.')).toBeTruthy()
    expect(screen.getByText('Schulte et al., 2010.')).toBeTruthy()
  })

  it('lists every tag, not only the primary one, each in its own palette colour', () => {
    render(<EventDetailPanel event={event()} onClose={vi.fn()} onShowOnTimeline={vi.fn()} onOpenBrowser={vi.fn()} />)
    const catastrophe = screen.getByText(EVENT_TAG_PALETTE.catastrophe.label)
    const life = screen.getByText(EVENT_TAG_PALETTE.life.label)
    expect(catastrophe.style.color).toBe(asRgb(EVENT_TAG_PALETTE.catastrophe.color))
    expect(life.style.color).toBe(asRgb(EVENT_TAG_PALETTE.life.color))
  })

  it('shows nothing where an event carries no tags', () => {
    render(<EventDetailPanel event={event({ tags: undefined })} onClose={vi.fn()} onShowOnTimeline={vi.fn()} onOpenBrowser={vi.fn()} />)
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('calls onShowOnTimeline, not onClose, from the Show on timeline action', () => {
    const onClose = vi.fn()
    const onShowOnTimeline = vi.fn()
    render(<EventDetailPanel event={event()} onClose={onClose} onShowOnTimeline={onShowOnTimeline} onOpenBrowser={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show on timeline' }))
    expect(onShowOnTimeline).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose via the panel it is built on', () => {
    const onClose = vi.fn()
    render(<EventDetailPanel event={event()} onClose={onClose} onShowOnTimeline={vi.fn()} onOpenBrowser={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('calls onOpenBrowser, not onClose, from the All events action', () => {
    const onClose = vi.fn()
    const onOpenBrowser = vi.fn()
    render(<EventDetailPanel event={event()} onClose={onClose} onShowOnTimeline={vi.fn()} onOpenBrowser={onOpenBrowser} />)
    fireEvent.click(screen.getByRole('button', { name: 'All events' }))
    expect(onOpenBrowser).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a `members` array of one behaves exactly like no `members` prop at all', () => {
    const solo = event({ tags: undefined })
    render(<EventDetailPanel event={solo} members={[solo]} onClose={vi.fn()} onShowOnTimeline={vi.fn()} onOpenBrowser={vi.fn()} />)
    // Same heading as the plain single-event case (no "+0 more"), and no digest member-list
    // wrapper (nor a tags one, disabled here the same way the no-tags test does) — a
    // single-member `members` array renders identically to omitting the prop.
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(solo.label)
    expect(screen.queryByRole('list')).toBeNull()
  })

  describe('digest (ADR-040)', () => {
    function member(id: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
      return event({ id, label: `Event ${id}`, description: `${id} description`, citation: `${id} citation`, ...overrides })
    }

    it('lists every reached member, not only the headline', () => {
      const headline = member('a')
      const second = member('b')
      const third = member('c')
      render(<EventDetailPanel event={headline} members={[headline, second, third]} onClose={vi.fn()} onShowOnTimeline={vi.fn()} onOpenBrowser={vi.fn()} />)

      const dialog = screen.getByRole('dialog')
      expect(dialog.textContent).toContain('Event a')
      expect(dialog.textContent).toContain('Event b')
      expect(dialog.textContent).toContain('Event c')
      expect(screen.getByText('a description')).toBeTruthy()
      expect(screen.getByText('b description')).toBeTruthy()
      expect(screen.getByText('c description')).toBeTruthy()
    })

    it("names the headline and the extra count in the panel's own heading", () => {
      const headline = member('a')
      render(<EventDetailPanel event={headline} members={[headline, member('b'), member('c')]} onClose={vi.fn()} onShowOnTimeline={vi.fn()} onOpenBrowser={vi.fn()} />)
      expect(screen.getByRole('dialog').textContent).toContain('Event a +2 more')
    })

    it('still shows only one "Show on timeline" action, scoped to the headline event', () => {
      const headline = member('a')
      const onShowOnTimeline = vi.fn()
      render(
        <EventDetailPanel
          event={headline}
          members={[headline, member('b')]}
          onClose={vi.fn()}
          onShowOnTimeline={onShowOnTimeline}
          onOpenBrowser={vi.fn()}
        />,
      )
      const buttons = screen.getAllByRole('button', { name: 'Show on timeline' })
      expect(buttons).toHaveLength(1)
      fireEvent.click(buttons[0]!)
      expect(onShowOnTimeline).toHaveBeenCalledTimes(1)
    })
  })

  describe('route', () => {
    const migration = event({
      id: 'yamnaya-steppe-migration',
      label: 'Yamnaya steppe migration',
      kind: 'period',
      t: undefined,
      tMin: 4600,
      tMax: 5000,
      tags: ['human-origins'],
      description: 'Steppe pastoralists move west into Europe.',
      effect: {
        kind: 'arrival',
        arrivalKind: 'migration',
        origin: { lat: 47.6, lon: 44.4 },
        destination: { lat: 51.2, lon: -1.8 },
        established: 4600,
        windows: [{ tMin: 0, tMax: 5000 }],
      },
    })
    const chain = [
      { id: 'neanderthal-sapiens-overlap', label: 'Modern humans reach Europe' },
      { id: 'out-of-africa-migration', label: 'Out of Africa' },
    ]

    function renderRoute(overrides: Partial<Parameters<typeof EventDetailPanel>[0]> = {}) {
      return render(
        <EventDetailPanel
          event={migration}
          onClose={vi.fn()}
          onShowOnTimeline={vi.fn()}
          onOpenBrowser={vi.fn()}
          arrivalChainFor={() => chain}
          {...overrides}
        />,
      )
    }

    it('shows a Route section with the arrival kind, established date and travelling span', () => {
      renderRoute()
      const route = screen.getByRole('region', { name: 'Route' })
      expect(route.textContent).toContain('Migration')
      expect(route.textContent).toContain(formatGeoTime(4600))
      expect(route.textContent).toContain(formatTimeRange([4600, 5000]))
    })

    it('names a peopling arrival as a first settlement', () => {
      renderRoute({ event: { ...migration, effect: { ...migration.effect!, arrivalKind: 'peopling' } as typeof migration.effect } })
      expect(screen.getByRole('region', { name: 'Route' }).textContent).toContain('First settlement')
    })

    it('labels its coarse origin and destination as schematic region centroids, not a route', () => {
      renderRoute()
      const route = screen.getByRole('region', { name: 'Route' })
      expect(route.textContent).toContain('48°N 44°E → 51°N 2°W')
      expect(route.textContent).toMatch(/schematic region centroids/i)
      expect(route.textContent).toMatch(/not a traced route/i)
    })

    it('lists the earlier arrivals it continues, each opening that event', () => {
      const onOpenEvent = vi.fn()
      renderRoute({ onOpenEvent })
      fireEvent.click(screen.getByRole('button', { name: 'Out of Africa' }))
      expect(onOpenEvent).toHaveBeenCalledExactlyOnceWith('out-of-africa-migration')
      expect(screen.getByRole('button', { name: 'Modern humans reach Europe' })).toBeTruthy()
    })

    it('lists the chain as plain text when no event can be opened from it', () => {
      renderRoute()
      expect(screen.queryByRole('button', { name: 'Out of Africa' })).toBeNull()
      expect(screen.getByRole('region', { name: 'Route' }).textContent).toContain('Out of Africa')
    })

    it('shows a single region for an arrival whose origin is its destination', () => {
      const origin = { ...migration.effect!, origin: { lat: 9, lon: 34 }, destination: { lat: 9, lon: 34 } } as typeof migration.effect
      renderRoute({ event: { ...migration, effect: origin }, arrivalChainFor: () => [] })
      const route = screen.getByRole('region', { name: 'Route' })
      expect(route.textContent).toContain('9°N 34°E')
      expect(route.textContent).not.toContain('→')
      expect(route.textContent).not.toContain('Continues')
    })

    it('has no Route section for an event without an arrival effect', () => {
      render(<EventDetailPanel event={event()} onClose={vi.fn()} onShowOnTimeline={vi.fn()} onOpenBrowser={vi.fn()} />)
      expect(screen.queryByRole('region', { name: 'Route' })).toBeNull()
    })
  })
})
