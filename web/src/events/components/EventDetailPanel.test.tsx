import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatGeoTime } from '@/timeline'
import type { TimelineEvent } from '@/types/layer'

import { EVENT_TAG_PALETTE } from '../tagPalette'
import { EventDetailPanel } from './EventDetailPanel'

afterEach(() => {
  cleanup()
})

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
    render(<EventDetailPanel event={event()} onClose={vi.fn()} onOpenBrowser={vi.fn()} />)
    expect(screen.getByRole('dialog').textContent).toContain('The K-Pg impact')
    expect(screen.getByText('A 10km asteroid strikes Chicxulub.')).toBeTruthy()
    expect(screen.getByText('Schulte et al., 2010.')).toBeTruthy()
  })

  it('lists every tag, not only the primary one', () => {
    render(<EventDetailPanel event={event()} onClose={vi.fn()} onOpenBrowser={vi.fn()} />)
    expect(screen.getByText(EVENT_TAG_PALETTE.catastrophe.label)).toBeTruthy()
    expect(screen.getByText(EVENT_TAG_PALETTE.life.label)).toBeTruthy()
  })

  it('routes Back to all events, and Escape, to their own callbacks', () => {
    const onClose = vi.fn()
    const onOpenBrowser = vi.fn()
    render(<EventDetailPanel event={event()} onClose={onClose} onOpenBrowser={onOpenBrowser} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to all events' }))
    expect(onOpenBrowser).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders a single-member digest exactly like a plain event', () => {
    const solo = event({ tags: undefined })
    render(<EventDetailPanel event={solo} members={[solo]} onClose={vi.fn()} onOpenBrowser={vi.fn()} />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(solo.label)
    expect(screen.queryByRole('list')).toBeNull()
  })

  describe('digest', () => {
    function member(id: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
      return event({ id, label: `Event ${id}`, description: `${id} description`, citation: `${id} citation`, ...overrides })
    }

    it('lists every reached member, not only the headline', () => {
      const headline = member('a')
      const second = member('b')
      const third = member('c')
      render(<EventDetailPanel event={headline} members={[headline, second, third]} onClose={vi.fn()} onOpenBrowser={vi.fn()} />)

      const dialog = screen.getByRole('dialog')
      expect(dialog.textContent).toContain('Event a +2 more')
      expect(dialog.textContent).toContain('Event b')
      expect(dialog.textContent).toContain('Event c')
      expect(screen.getByText('a description')).toBeTruthy()
      expect(screen.getByText('b description')).toBeTruthy()
      expect(screen.getByText('c description')).toBeTruthy()
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
         
          onOpenBrowser={vi.fn()}
          arrivalChainFor={() => chain}
          {...overrides}
        />,
      )
    }

    it('shows an arrival its Route, whose earlier arrivals each open that event, and no Route otherwise', () => {
      const onOpenEvent = vi.fn()
      renderRoute({ onOpenEvent })
      const route = screen.getByRole('region', { name: 'Route' })
      expect(route.textContent).toContain('Migration')
      expect(route.textContent).toContain(formatGeoTime(4600))
      fireEvent.click(screen.getByRole('button', { name: 'Out of Africa' }))
      expect(onOpenEvent).toHaveBeenCalledExactlyOnceWith('out-of-africa-migration')
      cleanup()
      render(<EventDetailPanel event={event()} onClose={vi.fn()} onOpenBrowser={vi.fn()} />)
      expect(screen.queryByRole('region', { name: 'Route' })).toBeNull()
    })
  })

  it('steps to a neighbour with the footer buttons or a horizontal swipe, never past an end', () => {
    const onStep = vi.fn()
    const older = event({ id: 'older', label: 'Older event' })
    render(
      <EventDetailPanel
        event={event()}
        onClose={vi.fn()}
        onOpenBrowser={vi.fn()}
        neighbours={{ older, newer: null }}
        onStep={onStep}
      />,
    )
    const next = screen.getByRole('button', { name: 'Next event' }) as HTMLButtonElement
    expect(next.disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Previous event: Older event' }))
    expect(onStep).toHaveBeenLastCalledWith('older')

    const body = screen.getByTestId('event-detail-body')
    const swipe = (dx: number, dy: number): void => {
      fireEvent.touchStart(body, { touches: [{ clientX: 200, clientY: 300 }] })
      fireEvent.touchEnd(body, { changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] })
    }
    onStep.mockClear()
    swipe(120, 140)
    swipe(-120, 10)
    expect(onStep).not.toHaveBeenCalled()
    swipe(120, 10)
    expect(onStep).toHaveBeenCalledExactlyOnceWith('older')
  })
})
