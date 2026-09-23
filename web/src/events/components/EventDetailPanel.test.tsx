import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
    render(<EventDetailPanel event={event()} onClose={vi.fn()} onShowOnTimeline={vi.fn()} onOpenBrowser={vi.fn()} />)
    expect(screen.getByRole('dialog').textContent).toContain('The K-Pg impact')
    expect(screen.getByText('A 10km asteroid strikes Chicxulub.')).toBeTruthy()
    expect(screen.getByText('Schulte et al., 2010.')).toBeTruthy()
  })

  it('lists every tag, not only the primary one', () => {
    render(<EventDetailPanel event={event()} onClose={vi.fn()} onShowOnTimeline={vi.fn()} onOpenBrowser={vi.fn()} />)
    expect(screen.getByText(EVENT_TAG_PALETTE.catastrophe.label)).toBeTruthy()
    expect(screen.getByText(EVENT_TAG_PALETTE.life.label)).toBeTruthy()
  })

  it('routes Show on timeline, All events and Escape to their own callbacks', () => {
    const onClose = vi.fn()
    const onShowOnTimeline = vi.fn()
    const onOpenBrowser = vi.fn()
    render(<EventDetailPanel event={event()} onClose={onClose} onShowOnTimeline={onShowOnTimeline} onOpenBrowser={onOpenBrowser} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show on timeline' }))
    fireEvent.click(screen.getByRole('button', { name: 'All events' }))
    expect(onShowOnTimeline).toHaveBeenCalledTimes(1)
    expect(onOpenBrowser).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders a single-member digest exactly like a plain event', () => {
    const solo = event({ tags: undefined })
    render(<EventDetailPanel event={solo} members={[solo]} onClose={vi.fn()} onShowOnTimeline={vi.fn()} onOpenBrowser={vi.fn()} />)
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
      render(<EventDetailPanel event={headline} members={[headline, second, third]} onClose={vi.fn()} onShowOnTimeline={vi.fn()} onOpenBrowser={vi.fn()} />)

      const dialog = screen.getByRole('dialog')
      expect(dialog.textContent).toContain('Event a +2 more')
      expect(dialog.textContent).toContain('Event b')
      expect(dialog.textContent).toContain('Event c')
      expect(screen.getByText('a description')).toBeTruthy()
      expect(screen.getByText('b description')).toBeTruthy()
      expect(screen.getByText('c description')).toBeTruthy()
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
})
