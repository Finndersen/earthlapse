import { describe, expect, it } from 'vitest'

import { createLinearScale, createSymlogScale, type TimeWindow } from '@/timeline'
import { EARTH_FORMATION, type TimelineEvent } from '@/types/layer'

import {
  DEFAULT_MAX_VISIBLE,
  feedCardOffsetPx,
  feedCardOpacity,
  MAX_CARD_OFFSET_PX,
  selectFeedEvents,
} from './select'

// A plain linear scale over an exact window so displayed pixel positions are hand-checkable
// (same trick as `timeline/declutter.test.ts`): `window = [0, 1000]`, `trackWidthPx = 1000`
// gives `px(t) = 1000 - t` (u = 0 at the oldest edge t = 1000, u = 1 at the newest edge t = 0).
const WINDOW: TimeWindow = [0, 1000]
const SCALE = createLinearScale(WINDOW)
const TRACK_PX = 1000

function event(id: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id, label: id, tMin: 0, tMax: 0, importance: 0.5, description: '', citation: '', ...overrides }
}

function ids(entries: { event: TimelineEvent }[]): string[] {
  return entries.map((e) => e.event.id)
}

describe('selectFeedEvents', () => {
  it('shows an event exactly at the playhead as freshest (distanceFraction 0)', () => {
    const a = event('a', { tMin: 500, tMax: 500 })
    const { visible } = selectFeedEvents([a], 500, SCALE, TRACK_PX)
    expect(visible).toEqual([{ event: a, distanceFraction: 0 }])
  })

  it('excludes an event ahead of the playhead — it has not happened yet from this vantage', () => {
    const future = event('future', { tMin: 400, tMax: 400 })
    const { visible } = selectFeedEvents([future], 500, SCALE, TRACK_PX)
    expect(visible).toEqual([])
  })

  it('is pure in t: revisiting the same t reproduces the exact same feed regardless of how it is reached', () => {
    const events = [event('a', { tMin: 480, tMax: 480 }), event('b', { tMin: 300, tMax: 300 })]
    const first = selectFeedEvents(events, 490, SCALE, TRACK_PX, { lookbackPx: 250 })
    // A second, independent call at the same t — nothing here remembers which direction a
    // caller most recently scrubbed from.
    const second = selectFeedEvents([...events].reverse(), 490, SCALE, TRACK_PX, { lookbackPx: 250 })
    expect(second).toEqual(first)
  })

  it('measures the lookback in displayed pixels, not raw years — a far event drops out first', () => {
    // At this 1:1 scale, lookbackPx=50 means "within 50 years behind t".
    const near = event('near', { tMin: 540, tMax: 540 }) // 40px behind t=500
    const far = event('far', { tMin: 560, tMax: 560 }) // 60px behind t=500
    const { visible } = selectFeedEvents([near, far], 500, SCALE, TRACK_PX, { lookbackPx: 50 })
    expect(ids(visible)).toEqual(['near'])
  })

  it('adapts to era density: the same lookbackPx spans far fewer years near the present than in deep time', () => {
    // The real timeline warp (`createSymlogScale`, not this file's other hand-checkable exact
    // linear scale): near-present years are expanded on screen, deep-time years are compressed,
    // so a fixed *displayed*-pixel lookback automatically means "a few years" near the present
    // and "hundreds of thousands of years" in sparse deep time, with no separate branch for
    // either regime.
    const symlogWindow: TimeWindow = [0, EARTH_FORMATION]
    const symlogScale = createSymlogScale(symlogWindow)
    const trackWidthPx = 1440
    const lookbackPx = 220
    const yearsBehind = 5e5

    const nearPresent = selectFeedEvents(
      [event('e', { tMin: 100 + yearsBehind, tMax: 100 + yearsBehind })],
      100,
      symlogScale,
      trackWidthPx,
      { lookbackPx },
    )
    const deepTime = selectFeedEvents(
      [event('e', { tMin: 3e9 + yearsBehind, tMax: 3e9 + yearsBehind })],
      3e9,
      symlogScale,
      trackWidthPx,
      { lookbackPx },
    )

    expect(nearPresent.visible).toEqual([]) // 500,000 years is already far, this close to the present
    expect(deepTime.visible).toHaveLength(1) // the identical 500,000-year gap is imperceptible in deep time
  })

  it('caps visible cards and reports the rest as overflowCount, freshest first', () => {
    const events = [
      event('e1', { tMin: 505, tMax: 505 }),
      event('e2', { tMin: 510, tMax: 510 }),
      event('e3', { tMin: 515, tMax: 515 }),
      event('e4', { tMin: 520, tMax: 520 }),
    ]
    const { visible, overflowCount } = selectFeedEvents(events, 500, SCALE, TRACK_PX, { maxVisible: 2, lookbackPx: 100 })
    expect(ids(visible)).toEqual(['e1', 'e2'])
    expect(overflowCount).toBe(2)
  })

  it('resolves a dense cluster of near-simultaneous events, defaulting to DEFAULT_MAX_VISIBLE cards', () => {
    const cluster = ['x1', 'x2', 'x3', 'x4', 'x5'].map((id, i) => event(id, { tMin: 500 + i * 1e-4, tMax: 500 + i * 1e-4 }))
    const { visible, overflowCount } = selectFeedEvents(cluster, 500, SCALE, TRACK_PX)
    expect(visible).toHaveLength(DEFAULT_MAX_VISIBLE)
    expect(overflowCount).toBe(cluster.length - DEFAULT_MAX_VISIBLE)
  })

  it('breaks a distance tie by importance, then breaks an importance tie by id', () => {
    const lowImportance = event('low', { tMin: 510, tMax: 510, importance: 0.2 })
    const highImportance = event('high', { tMin: 510, tMax: 510, importance: 0.9 })
    const byImportance = selectFeedEvents([lowImportance, highImportance], 500, SCALE, TRACK_PX, { lookbackPx: 50 })
    expect(ids(byImportance.visible)).toEqual(['high', 'low'])

    const b = event('b', { tMin: 510, tMax: 510, importance: 0.5 })
    const a = event('a', { tMin: 510, tMax: 510, importance: 0.5 })
    const byId = selectFeedEvents([b, a], 500, SCALE, TRACK_PX, { lookbackPx: 50 })
    expect(ids(byId.visible)).toEqual(['a', 'b'])
  })

  it('skips ids named in excludedEventIds outright — the scene-captioned exclusion', () => {
    const captioned = event('captioned', { tMin: 505, tMax: 505 })
    const other = event('other', { tMin: 506, tMax: 506 })
    const { visible } = selectFeedEvents([captioned, other], 500, SCALE, TRACK_PX, {
      excludedEventIds: new Set(['captioned']),
    })
    expect(ids(visible)).toEqual(['other'])
  })

  it('returns nothing when the track has not been measured yet', () => {
    const a = event('a', { tMin: 500, tMax: 500 })
    expect(selectFeedEvents([a], 500, SCALE, 0)).toEqual({ visible: [], overflowCount: 0 })
    expect(selectFeedEvents([a], 500, SCALE, -10)).toEqual({ visible: [], overflowCount: 0 })
  })

  it('counts every excess candidate as overflow when maxVisible is 0', () => {
    const events = [event('a', { tMin: 505, tMax: 505 }), event('b', { tMin: 506, tMax: 506 })]
    const { visible, overflowCount } = selectFeedEvents(events, 500, SCALE, TRACK_PX, { maxVisible: 0 })
    expect(visible).toEqual([])
    expect(overflowCount).toBe(2)
  })
})

describe('feedCardOpacity', () => {
  it('is fully opaque at distanceFraction 0 and fully transparent at 1', () => {
    expect(feedCardOpacity(0)).toBe(1)
    expect(feedCardOpacity(1)).toBe(0)
  })

  it('clamps outside [0, 1]', () => {
    expect(feedCardOpacity(-1)).toBe(1)
    expect(feedCardOpacity(2)).toBe(0)
  })

  it('eases out rather than fading linearly', () => {
    expect(feedCardOpacity(0.5)).toBeCloseTo(0.75)
  })
})

describe('feedCardOffsetPx', () => {
  it('runs from 0 to MAX_CARD_OFFSET_PX across [0, 1]', () => {
    expect(feedCardOffsetPx(0)).toBe(0)
    expect(feedCardOffsetPx(1)).toBe(MAX_CARD_OFFSET_PX)
    expect(feedCardOffsetPx(0.5)).toBeCloseTo(MAX_CARD_OFFSET_PX / 2)
  })

  it('clamps outside [0, 1]', () => {
    expect(feedCardOffsetPx(-1)).toBe(0)
    expect(feedCardOffsetPx(2)).toBe(MAX_CARD_OFFSET_PX)
  })
})
