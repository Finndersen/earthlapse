import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HUD_READOUT_THROTTLE_MS } from '@/lib/useThrottledValue'
import type { TimelineEvent } from '@/types/layer'

import { MIN_CARD_OPACITY } from '../presentation'
import { DEFAULT_MAX_VISIBLE } from '../select'
import { EventFeed } from './EventFeed'

/** The feed renders from a throttled t; `flush` lets a rerendered t reach the DOM. */
function withThrottledT(body: (flush: () => void) => void): void {
  vi.useFakeTimers()
  try {
    body(() => act(() => vi.advanceTimersByTime(HUD_READOUT_THROTTLE_MS)))
  } finally {
    vi.useRealTimers()
  }
}

function event(id: string, t: number, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id, label: id, tMin: t, tMax: t, importance: 0.5, description: `${id} description`, citation: `${id} citation`, ...overrides }
}

function mockMatchMedia(...matching: string[]): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: matching.some((fragment) => query.includes(fragment)),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

const cards = (container: HTMLElement) => container.querySelectorAll('[data-testid^="event-feed-card-"]')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Far enough apart that each stays its own cluster.
const FAR_APART = [505, 700, 950, 1300, 1750, 2300] as const

describe('<EventFeed>', () => {
  it('shows cards only for events behind the playhead, capped at DEFAULT_MAX_VISIBLE', () => {
    expect(cards(render(<EventFeed t={500} events={[]} onEventActivate={vi.fn()} />).container)).toHaveLength(0)
    cleanup()
    const events = FAR_APART.map((t, i) => event(`e${i}`, t))
    const { container } = render(<EventFeed t={500} events={[event('future', 400), ...events]} onEventActivate={vi.fn()} />)
    expect(cards(container)).toHaveLength(DEFAULT_MAX_VISIBLE)
    expect(container.querySelector('[data-testid="event-feed-card-future"]')).toBeNull()
  })

  it('shows a single card on a compact viewport', () => {
    mockMatchMedia('max-width')
    const { container } = render(<EventFeed t={500} events={FAR_APART.map((t, i) => event(`e${i}`, t))} onEventActivate={vi.fn()} />)
    expect(cards(container)).toHaveLength(1)
  })

  it('reports activation with every cluster member, without expanding in place', () => {
    const burst = [0, 1, 2].map((i) => event(`e${i}`, 505 + i))
    const onEventActivate = vi.fn()
    const { container, getByTestId } = render(<EventFeed t={500} events={burst} onEventActivate={onEventActivate} />)
    expect(cards(container)).toHaveLength(1)
    expect(getByTestId('event-feed-more-e0').textContent).toContain('+2 more')
    fireEvent.click(getByTestId('event-feed-card-e0'))
    expect(onEventActivate).toHaveBeenCalledWith(burst[0], burst)
    expect(getByTestId('event-feed-card-e0').hasAttribute('aria-expanded')).toBe(false)
  })

  it('announces the freshest card, with its extra count, in a polite live region', () => {
    const burst = [0, 1, 2].map((i) => event(`e${i}`, 505 + i, { label: i === 0 ? 'Announced thing' : `e${i}` }))
    const live = render(<EventFeed t={500} events={burst} onEventActivate={vi.fn()} />).container.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toContain('Announced thing')
    expect(live?.textContent).toContain('and 2 more')
  })

  it('keeps a card readable as t moves on with nothing newer to replace it', () => {
    withThrottledT((flush) => {
      const a = event('a', 315_000)
      const { getByTestId, rerender } = render(<EventFeed t={300_000} events={[a]} onEventActivate={vi.fn()} />)
      rerender(<EventFeed t={130_000} events={[a]} onEventActivate={vi.fn()} />)
      flush()
      expect(Number(getByTestId('event-feed-item-a').style.opacity)).toBeGreaterThanOrEqual(MIN_CARD_OPACITY)
    })
  })

  it('emphasises only the freshest card, as a pure function of t', () => {
    withThrottledT((flush) => {
      const a = event('a', 500)
      const { getByTestId, rerender } = render(<EventFeed t={500} events={[event('older', 700), a]} onEventActivate={vi.fn()} />)
      expect(getByTestId('event-feed-item-a').dataset.emphasised).toBe('true')
      expect(getByTestId('event-feed-item-older').dataset.emphasised).toBe('false')
      const emphasis = () => getByTestId('event-feed-item-a').style.getPropertyValue('--feed-emphasis')
      rerender(<EventFeed t={480} events={[a]} onEventActivate={vi.fn()} />)
      flush()
      const receding = emphasis()
      rerender(<EventFeed t={350} events={[a]} onEventActivate={vi.fn()} />)
      flush()
      expect(getByTestId('event-feed-item-a').dataset.emphasised).toBe('false')
      rerender(<EventFeed t={480} events={[a]} onEventActivate={vi.fn()} />)
      flush()
      expect(emphasis()).toBe(receding)
    })
  })

  it('reports the visible set only when it changes', () => {
    withThrottledT((flush) => {
      const events = [event('a', 505), event('b', 510)]
      const onVisibleEventsChange = vi.fn()
      const props = { events, onEventActivate: vi.fn(), onVisibleEventsChange }
      const { rerender } = render(<EventFeed t={500} {...props} />)
      expect(onVisibleEventsChange).toHaveBeenLastCalledWith(['a', 'b'])
      const calls = onVisibleEventsChange.mock.calls.length
      rerender(<EventFeed t={501} {...props} />)
      flush()
      expect(onVisibleEventsChange).toHaveBeenCalledTimes(calls)
      rerender(<EventFeed t={506} {...props} />)
      flush()
      expect(onVisibleEventsChange).toHaveBeenLastCalledWith(['b'])
    })
  })

  it('reports card hover and keyboard focus', () => {
    const onCardHoverChange = vi.fn()
    const { getByTestId } = render(<EventFeed t={500} events={[event('a', 505)]} onEventActivate={vi.fn()} onCardHoverChange={onCardHoverChange} />)
    const item = getByTestId('event-feed-item-a')
    fireEvent.pointerEnter(item)
    expect(onCardHoverChange).toHaveBeenLastCalledWith('a')
    fireEvent.pointerLeave(item)
    expect(onCardHoverChange).toHaveBeenLastCalledWith(null)
    fireEvent.focus(item)
    expect(onCardHoverChange).toHaveBeenLastCalledWith('a')
    fireEvent.blur(item)
    expect(onCardHoverChange).toHaveBeenLastCalledWith(null)
  })
})
