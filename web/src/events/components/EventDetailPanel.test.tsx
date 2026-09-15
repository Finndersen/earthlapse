import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
    render(<EventDetailPanel event={event()} onClose={vi.fn()} onShowOnTimeline={vi.fn()} />)
    expect(screen.getByRole('dialog').textContent).toContain('The K-Pg impact')
    expect(screen.getByText('A 10km asteroid strikes Chicxulub.')).toBeTruthy()
    expect(screen.getByText('Schulte et al., 2010.')).toBeTruthy()
  })

  it('lists every tag, not only the primary one, each in its own palette colour', () => {
    render(<EventDetailPanel event={event()} onClose={vi.fn()} onShowOnTimeline={vi.fn()} />)
    const catastrophe = screen.getByText(EVENT_TAG_PALETTE.catastrophe.label)
    const life = screen.getByText(EVENT_TAG_PALETTE.life.label)
    expect(catastrophe.style.color).toBe(asRgb(EVENT_TAG_PALETTE.catastrophe.color))
    expect(life.style.color).toBe(asRgb(EVENT_TAG_PALETTE.life.color))
  })

  it('shows nothing where an event carries no tags', () => {
    render(<EventDetailPanel event={event({ tags: undefined })} onClose={vi.fn()} onShowOnTimeline={vi.fn()} />)
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('calls onShowOnTimeline, not onClose, from the Show on timeline action', () => {
    const onClose = vi.fn()
    const onShowOnTimeline = vi.fn()
    render(<EventDetailPanel event={event()} onClose={onClose} onShowOnTimeline={onShowOnTimeline} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show on timeline' }))
    expect(onShowOnTimeline).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose via the panel it is built on', () => {
    const onClose = vi.fn()
    render(<EventDetailPanel event={event()} onClose={onClose} onShowOnTimeline={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
