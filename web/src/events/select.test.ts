import { describe, expect, it } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import { DEFAULT_LOOKBACK_AGE_RATIO, DEFAULT_MAX_VISIBLE, RECENCY_FLOOR_YEARS, selectFeedEvents } from './select'

function event(id: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id, label: id, tMin: 0, tMax: 0, importance: 0.5, description: '', citation: '', ...overrides }
}

function ids(entries: { event: TimelineEvent }[]): string[] {
  return entries.map((e) => e.event.id)
}

describe('selectFeedEvents', () => {
  it('shows an event exactly at the playhead as freshest (distanceFraction 0)', () => {
    const a = event('a', { tMin: 500, tMax: 500 })
    const { visible } = selectFeedEvents([a], 500)
    expect(visible).toEqual([{ event: a, distanceFraction: 0 }])
  })

  it('excludes an event ahead of the playhead — it has not happened yet from this vantage', () => {
    const future = event('future', { tMin: 400, tMax: 400 })
    const { visible } = selectFeedEvents([future], 500)
    expect(visible).toEqual([])
  })

  it('is pure in t: revisiting the same t reproduces the exact same feed regardless of how it is reached', () => {
    const events = [event('a', { tMin: 480, tMax: 480 }), event('b', { tMin: 300, tMax: 300 })]
    const first = selectFeedEvents(events, 490)
    // A second, independent call at the same t — nothing here remembers which direction a
    // caller most recently scrubbed from.
    const second = selectFeedEvents([...events].reverse(), 490)
    expect(second).toEqual(first)
  })

  it('bounds the lookback evenly across eras: the same ratio spans far fewer years near the present than in deep time', () => {
    // A fixed age ratio, not a fixed year count, is what keeps a near-present playhead from
    // reaching back tens of thousands of years while a deep-time one reaches back eons: the
    // *ratio* of (event age + floor) to (playhead age + floor) is what is bounded, not a raw
    // year difference.
    const yearsBehind = 5e5
    const nearPresent = selectFeedEvents([event('e', { tMin: 100 + yearsBehind, tMax: 100 + yearsBehind })], 100)
    const deepTime = selectFeedEvents([event('e', { tMin: 3e9 + yearsBehind, tMax: 3e9 + yearsBehind })], 3e9)

    expect(nearPresent.visible).toEqual([]) // 500,000 years is already far, this close to the present
    expect(deepTime.visible).toHaveLength(1) // the identical 500,000-year gap is imperceptible in deep time
  })

  it("refuses to fill an empty slot from beyond the lookback: 200 years ago does not reach the Neolithic", () => {
    const newcomen = event('newcomen', { tMin: 313, tMax: 313 })
    const neolithic = event('neolithic', { tMin: 9000, tMax: 9000 })
    const { visible } = selectFeedEvents([newcomen, neolithic], 200)
    expect(ids(visible)).toEqual(['newcomen'])
  })

  it('reports distanceFraction as the relative-age fraction, 1 exactly at FRESH_AGE_RATIO', () => {
    // 75 -> 175 years ago is (175 + 25) / (75 + 25) = the full 2x default age ratio.
    const e = event('e', { tMin: 175, tMax: 175 })
    const { visible } = selectFeedEvents([e], 75)
    expect(visible).toEqual([{ event: e, distanceFraction: 1 }])
  })

  it('keeps a lone card the feed still has room for, long after it has aged past the freshness scale', () => {
    // 315,000 years ago seen from 130,000 years ago is 2.4x the playhead's own age — well past
    // FRESH_AGE_RATIO, but nothing newer is waiting for the slot.
    const lone = event('lone', { tMin: 315_000, tMax: 315_000 })
    const { visible } = selectFeedEvents([lone], 130_000)
    expect(ids(visible)).toEqual(['lone'])
    expect(visible[0]!.distanceFraction).toBeGreaterThan(1)
  })

  it('holds the same cards as t advances while no newer event arrives to replace them', () => {
    const events = [
      event('a', { tMin: 510, tMax: 510 }),
      event('b', { tMin: 520, tMax: 520 }),
      event('c', { tMin: 530, tMax: 530 }),
    ]
    expect(ids(selectFeedEvents(events, 500).visible)).toEqual(['a', 'b', 'c'])
    expect(ids(selectFeedEvents(events, 200).visible)).toEqual(['a', 'b', 'c'])
  })

  it('drops the oldest card only once a newer event arrives to take the slot', () => {
    const standing = [
      event('a', { tMin: 510, tMax: 510 }),
      event('b', { tMin: 520, tMax: 520 }),
      event('c', { tMin: 530, tMax: 530 }),
    ]
    const arrival = event('d', { tMin: 210, tMax: 210 })
    expect(ids(selectFeedEvents([...standing, arrival], 200).visible)).toEqual(['d', 'a', 'b'])
  })

  it('stops reaching back at lookbackAgeRatio even with slots to spare', () => {
    const e = event('e', { tMin: 510, tMax: 510 })
    const edgeT = (510 + RECENCY_FLOOR_YEARS) / DEFAULT_LOOKBACK_AGE_RATIO - RECENCY_FLOOR_YEARS
    expect(ids(selectFeedEvents([e], edgeT + 1).visible)).toEqual(['e'])
    expect(selectFeedEvents([e], edgeT - 1).visible).toEqual([])
  })

  it('caps visible cards at maxVisible, freshest first', () => {
    const events = [
      event('e1', { tMin: 505, tMax: 505 }),
      event('e2', { tMin: 510, tMax: 510 }),
      event('e3', { tMin: 515, tMax: 515 }),
      event('e4', { tMin: 520, tMax: 520 }),
    ]
    const { visible } = selectFeedEvents(events, 500, { maxVisible: 2 })
    expect(ids(visible)).toEqual(['e1', 'e2'])
  })

  it('resolves a dense cluster of near-simultaneous events, defaulting to DEFAULT_MAX_VISIBLE cards', () => {
    const cluster = ['x1', 'x2', 'x3', 'x4', 'x5'].map((id, i) => event(id, { tMin: 500 + i * 1e-4, tMax: 500 + i * 1e-4 }))
    const { visible } = selectFeedEvents(cluster, 500)
    expect(visible).toHaveLength(DEFAULT_MAX_VISIBLE)
  })

  it('breaks a distance tie by importance, then breaks an importance tie by id', () => {
    const lowImportance = event('low', { tMin: 510, tMax: 510, importance: 0.2 })
    const highImportance = event('high', { tMin: 510, tMax: 510, importance: 0.9 })
    const byImportance = selectFeedEvents([lowImportance, highImportance], 500)
    expect(ids(byImportance.visible)).toEqual(['high', 'low'])

    const b = event('b', { tMin: 510, tMax: 510, importance: 0.5 })
    const a = event('a', { tMin: 510, tMax: 510, importance: 0.5 })
    const byId = selectFeedEvents([b, a], 500)
    expect(ids(byId.visible)).toEqual(['a', 'b'])
  })

  it('shows an event even when the current scene caption already names it — nothing is excluded', () => {
    // kpg-arrival and kpg-darkness both link the same k-pg-impact event; excluding an
    // already-captioned event would hide it for as long as either scene is on screen. Every
    // event behind the playhead shows, full stop.
    const captioned = event('captioned', { tMin: 505, tMax: 505 })
    const other = event('other', { tMin: 506, tMax: 506 })
    const { visible } = selectFeedEvents([captioned, other], 500)
    expect(ids(visible)).toEqual(['captioned', 'other'])
  })

  it('returns nothing when lookbackAgeRatio is 1 or below', () => {
    const a = event('a', { tMin: 500, tMax: 500 })
    expect(selectFeedEvents([a], 500, { lookbackAgeRatio: 1 })).toEqual({ visible: [] })
    expect(selectFeedEvents([a], 500, { lookbackAgeRatio: 0.5 })).toEqual({ visible: [] })
  })

  it('returns nothing when maxVisible is 0', () => {
    const events = [event('a', { tMin: 505, tMax: 505 }), event('b', { tMin: 506, tMax: 506 })]
    const { visible } = selectFeedEvents(events, 500, { maxVisible: 0 })
    expect(visible).toEqual([])
  })

  it('defaults DEFAULT_MAX_VISIBLE to 3', () => {
    expect(DEFAULT_MAX_VISIBLE).toBe(3)
  })
})
