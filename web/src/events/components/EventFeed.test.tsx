import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import { DEFAULT_MAX_VISIBLE } from '../select'
import { EVENT_TAG_PALETTE } from '../tagPalette'
import { EventFeed } from './EventFeed'
import styles from './EventFeed.module.css'

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
    expect(onEventActivate).toHaveBeenCalledWith(a)
    expect(button.textContent).not.toContain('a citation')
    expect(button.hasAttribute('aria-expanded')).toBe(false)
  })

  it('caps visible cards at a fixed DEFAULT_MAX_VISIBLE (3) for a dense stretch', () => {
    const events = Array.from({ length: 6 }, (_, i) => event(`e${i}`, { tMin: 505 + i, tMax: 505 + i }))
    const { container } = render(<EventFeed t={500} events={events} onEventActivate={vi.fn()} />)
    expect(DEFAULT_MAX_VISIBLE).toBe(3)
    expect(container.querySelectorAll('[data-testid^="event-feed-card-"]')).toHaveLength(3)
  })

  it('shows only one card in the compact (narrow-viewport) mode, regardless of how many are candidates', () => {
    mockMatchMedia(COMPACT_QUERY)
    const events = [
      event('e0', { tMin: 505, tMax: 505 }),
      event('e1', { tMin: 506, tMax: 506 }),
      event('e2', { tMin: 507, tMax: 507 }),
    ]
    const { getByTestId, queryByTestId } = render(<EventFeed t={500} events={events} onEventActivate={vi.fn()} />)
    expect(getByTestId('event-feed-card-e0')).toBeTruthy()
    expect(queryByTestId('event-feed-card-e1')).toBeNull()
    expect(queryByTestId('event-feed-card-e2')).toBeNull()
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
      const older = event('older', { tMin: 520, tMax: 520, tags: ['life'] })
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
      const a = event('a', { tMin: 500, tMax: 500 })
      const { getByTestId, rerender } = render(<EventFeed t={500} events={[a]} onEventActivate={vi.fn()} />)
      expect(emphasisOf(getByTestId('event-feed-item-a'))).toBe(1)

      rerender(<EventFeed t={480} events={[a]} onEventActivate={vi.fn()} />)
      const receding = emphasisOf(getByTestId('event-feed-item-a'))
      expect(receding).toBeGreaterThan(0)
      expect(receding).toBeLessThan(1)

      rerender(<EventFeed t={350} events={[a]} onEventActivate={vi.fn()} />)
      expect(getByTestId('event-feed-item-a').dataset.emphasised).toBe('false')

      rerender(<EventFeed t={480} events={[a]} onEventActivate={vi.fn()} />)
      expect(emphasisOf(getByTestId('event-feed-item-a'))).toBe(receding)
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
      expect(onVisibleEventsChange).toHaveBeenCalledTimes(callsAfterMount)

      // t moves past a's own placement: it drops out of the visible set entirely.
      rerender(<EventFeed t={506} events={[a, b]} onEventActivate={vi.fn()} onVisibleEventsChange={onVisibleEventsChange} />)
      expect(onVisibleEventsChange).toHaveBeenCalledTimes(callsAfterMount + 1)
      expect(onVisibleEventsChange).toHaveBeenLastCalledWith(['b'])
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
})
