import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import { EventBrowser } from './EventBrowser'

afterEach(() => {
  cleanup()
})

function event(id: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id, label: id, tMin: 0, tMax: 0, importance: 0.5, description: '', citation: '', ...overrides }
}

const EVENTS: TimelineEvent[] = [
  event('fire', { label: 'Control of Fire', tMin: 400_000, tMax: 400_000, tags: ['human-origins'] }),
  event('kpg', { label: 'The K-Pg impact', tMin: 66_000_000, tMax: 66_000_000, tags: ['catastrophe'] }),
  event('genome', { label: 'Human Genome Project', tMin: 25, tMax: 25, tags: ['science-technology'] }),
]

describe('EventBrowser', () => {
  it('lists every event, oldest first', () => {
    render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={vi.fn()} />)
    const rows = screen.getAllByRole('option').map((row) => row.textContent)
    expect(rows[0]).toContain('The K-Pg impact')
    expect(rows[1]).toContain('Control of Fire')
    expect(rows[2]).toContain('Human Genome Project')
  })

  it('narrows the list to a case-insensitive substring match as the search input changes', () => {
    render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={vi.fn()} />)
    fireEvent.change(screen.getByTestId('event-browser-search'), { target: { value: 'FIRE' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option').textContent).toContain('Control of Fire')
  })

  it('narrows the list to events carrying a selected tag, and resets on All', () => {
    render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Catastrophe/ }))
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option').textContent).toContain('The K-Pg impact')

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('highlights the event nearest t on mount', () => {
    render(<EventBrowser events={EVENTS} t={399_000} onClose={vi.fn()} onActivate={vi.fn()} />)
    const search = screen.getByTestId('event-browser-search')
    expect(search.getAttribute('aria-activedescendant')).toBe('event-browser-row-fire')
  })

  it('re-highlights the nearest row when t changes, without calling onActivate', () => {
    const onActivate = vi.fn()
    const { rerender } = render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={onActivate} />)
    expect(screen.getByTestId('event-browser-search').getAttribute('aria-activedescendant')).toBe('event-browser-row-genome')

    rerender(<EventBrowser events={EVENTS} t={66_000_000} onClose={vi.fn()} onActivate={onActivate} />)
    expect(screen.getByTestId('event-browser-search').getAttribute('aria-activedescendant')).toBe('event-browser-row-kpg')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('moves the active row with ArrowDown/ArrowUp and jumps with Enter', () => {
    const onActivate = vi.fn()
    render(<EventBrowser events={EVENTS} t={100e6} onClose={vi.fn()} onActivate={onActivate} />)
    const search = screen.getByTestId('event-browser-search')
    // Oldest first: kpg, fire, genome. t=100e6 starts the highlight on kpg (index 0).
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search.getAttribute('aria-activedescendant')).toBe('event-browser-row-fire')
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate.mock.calls[0]![0].id).toBe('fire')
  })

  it('does not move past either end of the list', () => {
    render(<EventBrowser events={EVENTS} t={100e6} onClose={vi.fn()} onActivate={vi.fn()} />)
    const search = screen.getByTestId('event-browser-search')
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    expect(search.getAttribute('aria-activedescendant')).toBe('event-browser-row-kpg')
  })

  it('calls onActivate when a row is clicked', () => {
    const onActivate = vi.fn()
    render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={onActivate} />)
    fireEvent.click(screen.getByTestId('event-browser-row-button-genome'))
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate.mock.calls[0]![0].id).toBe('genome')
  })

  it('closes on Escape from anywhere on the page, not just the panel itself', () => {
    const onClose = vi.fn()
    render(<EventBrowser events={EVENTS} t={25} onClose={onClose} onActivate={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes via its own close button', () => {
    const onClose = vi.fn()
    render(<EventBrowser events={EVENTS} t={25} onClose={onClose} onActivate={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows a no-match message when nothing matches the query', () => {
    render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={vi.fn()} />)
    fireEvent.change(screen.getByTestId('event-browser-search'), { target: { value: 'nonexistent-xyz' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No events match.')).toBeTruthy()
  })

  it('is not aria-modal: a non-modal dialog, since the timeline behind it stays interactive', () => {
    render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={vi.fn()} />)
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBeNull()
  })

  it('renders a section rail with one label per section change, none when there are no results', () => {
    render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={vi.fn()} />)
    const rail = screen.getByTestId('event-browser-rail')
    // kpg (Mesozoic/Cenozoic boundary era), fire (human-history), genome (human-history): at
    // least two distinct section entries across the three events.
    expect(rail.children.length).toBeGreaterThanOrEqual(2)

    fireEvent.change(screen.getByTestId('event-browser-search'), { target: { value: 'nonexistent-xyz' } })
    expect(screen.queryByTestId('event-browser-rail')).toBeNull()
  })

  it('a rail drag scrolls the list without ever calling onActivate', () => {
    const onActivate = vi.fn()
    render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={onActivate} />)
    const rail = screen.getByTestId('event-browser-rail')
    vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 100,
      left: 0,
      right: 28,
      width: 28,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    fireEvent.pointerDown(rail, { clientY: 99, pointerId: 1 })
    // The last entry (kpg, fire or genome's own section) is now highlighted, and no jump to `t`
    // ever happened — dragging the rail only ever scrolls.
    expect(screen.getByTestId('event-browser-search').getAttribute('aria-activedescendant')).toBe(
      'event-browser-row-genome',
    )
    expect(onActivate).not.toHaveBeenCalled()
  })
})
