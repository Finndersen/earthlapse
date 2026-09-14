import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLinearScale, type TimeWindow } from '@/timeline'
import type { TimelineEvent } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { EventFeed } from './EventFeed'

// Same hand-checkable exact scale as `select.test.ts`: window [0, 1000], trackWidthPx from the
// mocked getBoundingClientRect below, so px(t) = width * (1000 - t) / 1000.
const WINDOW: TimeWindow = [0, 1000]
const SCALE = createLinearScale(WINDOW)
const TRACK_WIDTH = 400

function event(id: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id, label: id, tMin: 0, tMax: 0, importance: 0.5, description: `${id} description`, citation: `${id} citation`, ...overrides }
}

function scene(overrides: Partial<Scene>): Scene {
  return { id: 'scene', t: 0, chapterId: 'c', image: 'i.jpg', shot: 'WATER_EDGE', caption: '', width: 1, height: 1, ...overrides }
}

/** Same minimal `MediaQueryList` stand-in as `timeline/components/TimelineHint.test.tsx`. */
function mockMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: TRACK_WIDTH,
    bottom: 40,
    width: TRACK_WIDTH,
    height: 40,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('<EventFeed>', () => {
  it('renders no cards or overflow line when nothing is behind the playhead', () => {
    const { getByTestId, queryByTestId } = render(<EventFeed t={500} scale={SCALE} events={[]} onScrub={vi.fn()} />)
    // The measuring wrapper itself stays mounted (see EventFeed.tsx's own doc comment: it needs
    // its own width to select anything at all), but carries no cards and no visible text.
    const feed = getByTestId('event-feed')
    expect(feed.querySelector('[data-testid^="event-feed-card-"]')).toBeNull()
    expect(queryByTestId('event-feed-overflow')).toBeNull()
    expect(feed.textContent).toBe('')
  })

  it('shows a card for an event just behind the playhead', () => {
    const a = event('a', { tMin: 510, tMax: 510, label: 'First thing' })
    const { getByTestId } = render(<EventFeed t={500} scale={SCALE} events={[a]} onScrub={vi.fn()} />)
    expect(getByTestId('event-feed-card-a').textContent).toContain('First thing')
  })

  it('excludes an event the currently-captioned scene already names (ADR-022 Scene.events)', () => {
    const captioned = event('captioned', { tMin: 505, tMax: 505 })
    const scenes = [scene({ id: 's', t: 500, events: ['captioned'] })]
    const { queryByTestId } = render(<EventFeed t={500} scale={SCALE} events={[captioned]} scenes={scenes} onScrub={vi.fn()} />)
    expect(queryByTestId('event-feed-card-captioned')).toBeNull()
  })

  it('does not exclude an event a *different* scene names', () => {
    const other = event('other-event', { tMin: 505, tMax: 505 })
    const scenes = [scene({ id: 's', t: 500, events: ['some-other-id'] })]
    const { getByTestId } = render(<EventFeed t={500} scale={SCALE} events={[other]} scenes={scenes} onScrub={vi.fn()} />)
    expect(getByTestId('event-feed-card-other-event')).toBeTruthy()
  })

  it('expands to the full description and citation on click, and scrubs to the event', () => {
    const a = event('a', { tMin: 505, tMax: 505, description: 'Full description here.', citation: 'Some Citation, 2020.' })
    const onScrub = vi.fn()
    const { getByTestId } = render(<EventFeed t={500} scale={SCALE} events={[a]} onScrub={onScrub} />)
    const button = getByTestId('event-feed-card-a')

    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.textContent).not.toContain('Some Citation, 2020.')

    fireEvent.click(button)
    expect(onScrub).toHaveBeenCalledWith(505)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.textContent).toContain('Some Citation, 2020.')

    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('collapses the expanded card on Escape', () => {
    const a = event('a', { tMin: 505, tMax: 505 })
    const { getByTestId } = render(<EventFeed t={500} scale={SCALE} events={[a]} onScrub={vi.fn()} />)
    const card = getByTestId('event-feed-card-a')
    fireEvent.click(card)
    expect(card.getAttribute('aria-expanded')).toBe('true')

    fireEvent.keyDown(card, { key: 'Escape' })
    expect(card.getAttribute('aria-expanded')).toBe('false')
  })

  it('caps visible cards with a "+k more" line for a dense stretch', () => {
    const events = Array.from({ length: 5 }, (_, i) => event(`e${i}`, { tMin: 505 + i, tMax: 505 + i }))
    const { getByTestId } = render(<EventFeed t={500} scale={SCALE} events={events} onScrub={vi.fn()} />)
    expect(getByTestId('event-feed-overflow').textContent).toBe('+3 more')
  })

  it('announces the freshest event once via a polite aria-live region', () => {
    const a = event('a', { tMin: 505, tMax: 505, label: 'Announced thing' })
    const { container } = render(<EventFeed t={500} scale={SCALE} events={[a]} onScrub={vi.fn()} />)
    const live = container.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toContain('Announced thing')
  })

  it('shows only one card in the compact (narrow-viewport) mode', () => {
    mockMatchMedia(true)
    const events = [event('e0', { tMin: 505, tMax: 505 }), event('e1', { tMin: 506, tMax: 506 })]
    const { getByTestId, queryByTestId } = render(<EventFeed t={500} scale={SCALE} events={events} onScrub={vi.fn()} />)
    expect(getByTestId('event-feed-card-e0')).toBeTruthy()
    expect(queryByTestId('event-feed-card-e1')).toBeNull()
    expect(getByTestId('event-feed-overflow').textContent).toBe('+1 more')
  })
})
