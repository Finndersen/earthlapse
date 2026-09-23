import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HUD_READOUT_THROTTLE_MS } from '@/lib/useThrottledValue'
import type { TimelineEvent } from '@/types/layer'

import { MIN_CARD_OPACITY } from '../presentation'
import { DEFAULT_MAX_VISIBLE } from '../select'
import { EVENT_TAG_PALETTE } from '../tagPalette'
import { EventFeed } from './EventFeed'
import styles from './EventFeed.module.css'

/** The feed renders from a throttled `t` (`@/lib/useThrottledValue`), so a `t` change made by a
 *  synchronous rerender reaches the DOM only once the throttle window elapses. Runs `body` with
 *  fake timers and hands it a flush to call after each such rerender. */
function withThrottledT(body: (flush: () => void) => void): void {
  vi.useFakeTimers()
  try {
    body(() => {
      act(() => {
        vi.advanceTimersByTime(HUD_READOUT_THROTTLE_MS)
      })
    })
  } finally {
    vi.useRealTimers()
  }
}

const REDUCED_MOTION_QUERY = 'prefers-reduced-motion'
const COMPACT_QUERY = 'max-width'

/** jsdom normalises an inline hex colour to `rgb(...)` on readback. */
function asRgb(hex: string): string {
  const [r, g, b] = hex
    .replace('#', '')
    .match(/.{2}/g)!
    .map((h) => parseInt(h, 16))
  return `rgb(${r}, ${g}, ${b})`
}

function event(id: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id, label: id, tMin: 0, tMax: 0, importance: 0.5, description: `${id} description`, citation: `${id} citation`, ...overrides }
}

/** A minimal `MediaQueryList` stand-in, matching only queries containing one of `matching` — so reduced motion and the compact
 *  viewport can be switched on independently. */
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

function emphasisOf(item: HTMLElement): number {
  return Number(item.style.getPropertyValue('--feed-emphasis'))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('<EventFeed>', () => {
  it('renders no cards when nothing is behind the playhead', () => {
    const { getByTestId } = render(<EventFeed t={500} events={[]} onEventActivate={vi.fn()} />)
    // The measuring wrapper itself stays mounted (see EventFeed.tsx's own doc comment: it keeps
    // the aria-live region alive across an empty-to-populated transition), but carries no cards
    // and no visible text.
    const feed = getByTestId('event-feed')
    expect(feed.querySelector('[data-testid^="event-feed-card-"]')).toBeNull()
    expect(feed.textContent).toBe('')
  })

  it('shows a card for an event just behind the playhead', () => {
    const a = event('a', { tMin: 510, tMax: 510, label: 'First thing' })
    const { getByTestId } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} />)
    expect(getByTestId('event-feed-card-a').textContent).toContain('First thing')
  })

  it('shows the primary tag as a label in the tag colour next to the date', () => {
    const a = event('a', { tMin: 505, tMax: 505, tags: ['catastrophe', 'life'] })
    const { getByTestId } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} />)
    const card = getByTestId('event-feed-card-a')
    const tagLabel = card.querySelector<HTMLElement>(`.${styles.tag}`)
    expect(tagLabel?.textContent).toBe(EVENT_TAG_PALETTE.catastrophe.label)
    expect(tagLabel?.style.color).toBe(asRgb(EVENT_TAG_PALETTE.catastrophe.color))
  })

  it('shows no tag label for an untagged event', () => {
    const a = event('a', { tMin: 505, tMax: 505 })
    const { getByTestId } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} />)
    expect(getByTestId('event-feed-card-a').querySelector(`.${styles.tag}`)).toBeNull()
  })

  it('reports activation without scrubbing or opening anything in place — the caller owns the detail panel', () => {
    const a = event('a', { tMin: 505, tMax: 505 })
    const onEventActivate = vi.fn()
    const { getByTestId } = render(<EventFeed t={500} events={[a]} onEventActivate={onEventActivate} />)
    const button = getByTestId('event-feed-card-a')

    expect(button.textContent).not.toContain('a citation')

    fireEvent.click(button)
    expect(onEventActivate).toHaveBeenCalledWith(a, [a])
    expect(button.textContent).not.toContain('a citation')
    expect(button.hasAttribute('aria-expanded')).toBe(false)
  })

  it('keeps a card on screen, and readable, as t moves on with no newer event to replace it', () => {
    withThrottledT((flush) => {
      const a = event('a', { tMin: 315_000, tMax: 315_000 })
      const { getByTestId, rerender } = render(<EventFeed t={300_000} events={[a]} onEventActivate={vi.fn()} />)
      expect(getByTestId('event-feed-card-a')).toBeTruthy()

      rerender(<EventFeed t={130_000} events={[a]} onEventActivate={vi.fn()} />)
      flush()
      expect(getByTestId('event-feed-card-a')).toBeTruthy()
      expect(Number(getByTestId('event-feed-item-a').style.opacity)).toBeGreaterThanOrEqual(MIN_CARD_OPACITY)
    })
  })

  // Well beyond CLUSTER_SPAN apart (a ratio comfortably above the ~1.087x CLUSTER_SPAN=0.12
  // merges below), so each stays its own singleton cluster — these events exercise the
  // maxVisible cap itself, not the digest-clustering behaviour covered separately below.
  const FAR_APART = [505, 700, 950, 1300, 1750, 2300] as const

  it('caps visible cards at a fixed DEFAULT_MAX_VISIBLE (3) for well-separated events', () => {
    const events = FAR_APART.map((t, i) => event(`e${i}`, { tMin: t, tMax: t }))
    const { container } = render(<EventFeed t={500} events={events} onEventActivate={vi.fn()} />)
    expect(DEFAULT_MAX_VISIBLE).toBe(3)
    expect(container.querySelectorAll('[data-testid^="event-feed-card-"]')).toHaveLength(3)
  })

  it('shows only one card in the compact (narrow-viewport) mode, regardless of how many are candidates', () => {
    mockMatchMedia(COMPACT_QUERY)
    const events = [
      event('e0', { tMin: FAR_APART[0], tMax: FAR_APART[0] }),
      event('e1', { tMin: FAR_APART[1], tMax: FAR_APART[1] }),
      event('e2', { tMin: FAR_APART[2], tMax: FAR_APART[2] }),
    ]
    const { getByTestId, queryByTestId } = render(<EventFeed t={500} events={events} onEventActivate={vi.fn()} />)
    expect(getByTestId('event-feed-card-e0')).toBeTruthy()
    expect(queryByTestId('event-feed-card-e1')).toBeNull()
    expect(queryByTestId('event-feed-card-e2')).toBeNull()
  })

  describe('burst digest cards (ADR-040)', () => {
    it('collapses a dense stretch of near-simultaneous events into one card with a "+k more" badge', () => {
      const burst = Array.from({ length: 6 }, (_, i) => event(`e${i}`, { tMin: 505 + i, tMax: 505 + i }))
      const { container, getByTestId, queryByTestId } = render(<EventFeed t={500} events={burst} onEventActivate={vi.fn()} />)
      // The whole burst is one card, not six competing individual events.
      expect(container.querySelectorAll('[data-testid^="event-feed-card-"]')).toHaveLength(1)
      expect(getByTestId('event-feed-card-e0')).toBeTruthy()
      expect(getByTestId('event-feed-more-e0').textContent).toContain('+5 more')
      expect(queryByTestId('event-feed-card-e1')).toBeNull() // not its own card — a member of e0's digest
    })

    it('shows no "+k more" badge on a single-member card', () => {
      const a = event('a', { tMin: 510, tMax: 510 })
      const { queryByTestId } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} />)
      expect(queryByTestId('event-feed-more-a')).toBeNull()
    })

    it('reports every reached member, not just the headline, via onEventActivate', () => {
      const burst = Array.from({ length: 3 }, (_, i) => event(`e${i}`, { tMin: 505 + i, tMax: 505 + i }))
      const onEventActivate = vi.fn()
      const { getByTestId } = render(<EventFeed t={500} events={burst} onEventActivate={onEventActivate} />)
      fireEvent.click(getByTestId('event-feed-card-e0'))
      expect(onEventActivate).toHaveBeenCalledWith(burst[0], burst)
    })

    it('mentions the extra count in the aria-live announcement instead of dropping it', () => {
      const burst = Array.from({ length: 3 }, (_, i) => event(`e${i}`, { tMin: 505 + i, tMax: 505 + i }))
      const { container } = render(<EventFeed t={500} events={burst} onEventActivate={vi.fn()} />)
      const live = container.querySelector('[aria-live="polite"]')
      expect(live?.textContent).toContain('and 2 more')
    })
  })

  it("does not drift a card's position between renders at the same rank: opacity is the only thing distanceFraction changes inline", () => {
    // Root-cause regression coverage for the fixed jitter bug: a card's own inline style must
    // never carry a `transform` derived from `distanceFraction` — only `opacity` may vary with
    // it. See scripts/qa's `event-feed-card-position-stable-across-t` for the drawn-pixel
    // version of this same check.
    const a = event('a', { tMin: 510, tMax: 510 })
    const { getByTestId, rerender } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} />)
    const item = getByTestId('event-feed-item-a')
    expect(item.style.transform).toBe('')

    rerender(<EventFeed t={480} events={[a]} onEventActivate={vi.fn()} />)
    expect(getByTestId('event-feed-item-a').style.transform).toBe('')
  })

  it('announces the freshest event once via a polite aria-live region', () => {
    const a = event('a', { tMin: 505, tMax: 505, label: 'Announced thing' })
    const { container } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} />)
    const live = container.querySelector('[aria-live="polite"]')
    expect(live?.textContent).toContain('Announced thing')
  })

  describe('just-reached emphasis', () => {
    it('emphasises only the freshest card, in its primary tag colour', () => {
      const fresh = event('fresh', { tMin: 500, tMax: 500, tags: ['catastrophe', 'life'] })
      const older = event('older', { tMin: 700, tMax: 700, tags: ['life'] }) // far enough apart to stay its own cluster
      const { getByTestId } = render(<EventFeed t={500} events={[older, fresh]} onEventActivate={vi.fn()} />)

      const freshItem = getByTestId('event-feed-item-fresh')
      const olderItem = getByTestId('event-feed-item-older')
      expect(freshItem.dataset.emphasised).toBe('true')
      expect(emphasisOf(freshItem)).toBe(1)
      expect(freshItem.style.getPropertyValue('--feed-accent')).toBe(EVENT_TAG_PALETTE.catastrophe.color)
      expect(olderItem.dataset.emphasised).toBe('false')
      expect(emphasisOf(olderItem)).toBe(0)
    })

    it('settles as the card recedes, and returns exactly when scrubbing back to the same t', () => {
      withThrottledT((flush) => {
        const a = event('a', { tMin: 500, tMax: 500 })
        const { getByTestId, rerender } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} />)
        expect(emphasisOf(getByTestId('event-feed-item-a'))).toBe(1)

        rerender(<EventFeed t={480} events={[a]} onEventActivate={vi.fn()} />)
        flush()
        const receding = emphasisOf(getByTestId('event-feed-item-a'))
        expect(receding).toBeGreaterThan(0)
        expect(receding).toBeLessThan(1)

        rerender(<EventFeed t={350} events={[a]} onEventActivate={vi.fn()} />)
        flush()
        expect(getByTestId('event-feed-item-a').dataset.emphasised).toBe('false')

        rerender(<EventFeed t={480} events={[a]} onEventActivate={vi.fn()} />)
        flush()
        expect(emphasisOf(getByTestId('event-feed-item-a'))).toBe(receding)
      })
    })

    it('animates arrival and inset when motion is allowed', () => {
      const a = event('a', { tMin: 510, tMax: 510 })
      const { getByTestId } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} />)
      const item = getByTestId('event-feed-item-a')
      expect(item.className.split(' ')).toContain(styles.cardAnimated)
      expect(item.querySelector<HTMLElement>(`.${styles.body}`)?.style.transform).toMatch(/^translateX\(/)
    })

    it('keeps a static highlight but no motion under prefers-reduced-motion', () => {
      mockMatchMedia(REDUCED_MOTION_QUERY)
      const a = event('a', { tMin: 510, tMax: 510 })
      const { getByTestId } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} />)
      const item = getByTestId('event-feed-item-a')

      expect(item.dataset.emphasised).toBe('true')
      expect(emphasisOf(item)).toBeGreaterThan(0)
      expect(item.className.split(' ')).not.toContain(styles.cardAnimated)
      expect(item.querySelector<HTMLElement>(`.${styles.body}`)?.style.transform).toBe('')
    })
  })

  describe('onVisibleEventsChange', () => {
    it('fires with the visible event ids, and again only once the set itself changes', () => {
      withThrottledT((flush) => {
      const a = event('a', { tMin: 505, tMax: 505 })
      const b = event('b', { tMin: 510, tMax: 510 })
      const onVisibleEventsChange = vi.fn()
      const { rerender } = render(
        <EventFeed t={500} events={[a, b]} onEventActivate={vi.fn()} onVisibleEventsChange={onVisibleEventsChange} />,
      )
      expect(onVisibleEventsChange).toHaveBeenLastCalledWith(['a', 'b'])
      const callsAfterMount = onVisibleEventsChange.mock.calls.length

      // t moves, but both events are still behind the playhead — the visible set is unchanged.
      rerender(<EventFeed t={501} events={[a, b]} onEventActivate={vi.fn()} onVisibleEventsChange={onVisibleEventsChange} />)
      flush()
      expect(onVisibleEventsChange).toHaveBeenCalledTimes(callsAfterMount)

      // t moves past a's own placement: it drops out of the visible set entirely.
      rerender(<EventFeed t={506} events={[a, b]} onEventActivate={vi.fn()} onVisibleEventsChange={onVisibleEventsChange} />)
      flush()
      expect(onVisibleEventsChange).toHaveBeenCalledTimes(callsAfterMount + 1)
      expect(onVisibleEventsChange).toHaveBeenLastCalledWith(['b'])
      })
    })
  })

  describe('onCardHoverChange', () => {
    it('fires the event id on pointer enter and null on pointer leave', () => {
      const a = event('a', { tMin: 505, tMax: 505 })
      const onCardHoverChange = vi.fn()
      const { getByTestId } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} onCardHoverChange={onCardHoverChange} />)
      const item = getByTestId('event-feed-item-a')

      fireEvent.pointerEnter(item)
      expect(onCardHoverChange).toHaveBeenLastCalledWith('a')

      fireEvent.pointerLeave(item)
      expect(onCardHoverChange).toHaveBeenLastCalledWith(null)
    })

    it('fires the event id on focus and null on blur, for a keyboard user', () => {
      const a = event('a', { tMin: 505, tMax: 505 })
      const onCardHoverChange = vi.fn()
      const { getByTestId } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} onCardHoverChange={onCardHoverChange} />)
      const item = getByTestId('event-feed-item-a')

      fireEvent.focus(item)
      expect(onCardHoverChange).toHaveBeenLastCalledWith('a')

      fireEvent.blur(item)
      expect(onCardHoverChange).toHaveBeenLastCalledWith(null)
    })
  })

  describe('onOpenBrowser', () => {
    it('renders no "All events" button without onOpenBrowser', () => {
      const a = event('a', { tMin: 505, tMax: 505 })
      const { queryByTestId } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} />)
      expect(queryByTestId('event-feed-browse')).toBeNull()
    })

    it('renders an "All events" button beneath the cards that calls onOpenBrowser', () => {
      const a = event('a', { tMin: 505, tMax: 505 })
      const onOpenBrowser = vi.fn()
      const onEventActivate = vi.fn()
      const { getByRole, getByTestId } = render(
        <EventFeed t={500} events={[a]} onEventActivate={onEventActivate} onOpenBrowser={onOpenBrowser} />,
      )
      const button = getByRole('button', { name: 'All events' })
      expect(button.getAttribute('aria-haspopup')).toBe('dialog')
      expect(getByTestId('event-feed-card-a').compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      fireEvent.click(button)
      expect(onOpenBrowser).toHaveBeenCalledTimes(1)
      expect(onEventActivate).not.toHaveBeenCalled()
    })

    it('renders the button outside the aria-live region, even with no cards showing', () => {
      const onOpenBrowser = vi.fn()
      const { getByRole, getByTestId } = render(<EventFeed t={500} events={[]} onEventActivate={vi.fn()} onOpenBrowser={onOpenBrowser} />)
      const button = getByRole('button', { name: 'All events' })
      expect(button.closest('[aria-live]')).toBeNull()
      expect(getByTestId('event-feed').querySelector('[aria-live]')?.contains(button)).toBe(false)

      fireEvent.click(button)
      expect(onOpenBrowser).toHaveBeenCalledTimes(1)
    })

    it('keeps the accessible name "All events" on the compact strip\'s glyph-only button', () => {
      mockMatchMedia(COMPACT_QUERY)
      const a = event('a', { tMin: 505, tMax: 505 })
      const onOpenBrowser = vi.fn()
      const { getByRole } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} onOpenBrowser={onOpenBrowser} />)
      const button = getByRole('button', { name: 'All events' })
      expect(button.querySelector(`.${styles.browseText}`)?.textContent).toBe('All events')
      expect(button.querySelector(`.${styles.browseGlyph}`)?.getAttribute('aria-hidden')).toBe('true')

      fireEvent.click(button)
      expect(onOpenBrowser).toHaveBeenCalledTimes(1)
    })
  })
})
