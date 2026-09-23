import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import { EventBrowser } from './EventBrowser'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
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
  it.each([
    ['focuses the search box with a mouse', false, 'event-browser-search'],
    ['focuses the panel, not the search box, on a touch screen', true, 'event-browser'],
  ])('%s', (_, coarse, focusedTestId) => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query === '(pointer: coarse)' }))
    render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={vi.fn()} />)
    expect(document.activeElement).toBe(screen.getByTestId(focusedTestId))
  })

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

  it('highlights the row nearest t, following t without activating', () => {
    const onActivate = vi.fn()
    const { rerender } = render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={onActivate} />)
    expect(screen.getByTestId('event-browser-search').getAttribute('aria-activedescendant')).toBe('event-browser-row-genome')

    rerender(<EventBrowser events={EVENTS} t={66_000_000} onClose={vi.fn()} onActivate={onActivate} />)
    expect(screen.getByTestId('event-browser-search').getAttribute('aria-activedescendant')).toBe('event-browser-row-kpg')
    expect(onActivate).not.toHaveBeenCalled()
  })

  it('moves the active row with the arrow keys, clamped at the ends, and activates with Enter', () => {
    const onActivate = vi.fn()
    render(<EventBrowser events={EVENTS} t={100e6} onClose={vi.fn()} onActivate={onActivate} />)
    const search = screen.getByTestId('event-browser-search')
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    expect(search.getAttribute('aria-activedescendant')).toBe('event-browser-row-kpg')
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search.getAttribute('aria-activedescendant')).toBe('event-browser-row-fire')
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate.mock.calls[0]![0].id).toBe('fire')
  })

  it('calls onActivate when a row is clicked', () => {
    const onActivate = vi.fn()
    render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={onActivate} />)
    fireEvent.click(screen.getByTestId('event-browser-row-button-genome'))
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate.mock.calls[0]![0].id).toBe('genome')
  })

  it('closes on Escape from anywhere and from its Close button', () => {
    const onClose = vi.fn()
    render(<EventBrowser events={EVENTS} t={25} onClose={onClose} onActivate={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows a no-match message and drops the rail when nothing matches', () => {
    render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={vi.fn()} />)
    fireEvent.change(screen.getByTestId('event-browser-search'), { target: { value: 'nonexistent-xyz' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText('No events match.')).toBeTruthy()
    expect(screen.queryByTestId('event-browser-rail')).toBeNull()
  })

  it('is a non-modal dialog, since the timeline behind it stays interactive', () => {
    render(<EventBrowser events={EVENTS} t={25} onClose={vi.fn()} onActivate={vi.fn()} />)
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBeNull()
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
    expect(screen.getByTestId('event-browser-search').getAttribute('aria-activedescendant')).toBe(
      'event-browser-row-genome',
    )
    expect(onActivate).not.toHaveBeenCalled()
  })
})
