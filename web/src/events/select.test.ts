import { describe, expect, it } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import { DEFAULT_LOOKBACK_AGE_RATIO, RECENCY_FLOOR_YEARS, selectFeedEvents } from './select'

function event(id: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id, label: id, tMin: 0, tMax: 0, importance: 0.5, description: '', citation: '', ...overrides }
}

function ids(entries: { event: TimelineEvent }[]): string[] {
  return entries.map((e) => e.event.id)
}

function memberIds(entries: { members: readonly TimelineEvent[] }[]): string[] {
  return entries.flatMap((e) => e.members.map((m) => m.id))
}

describe('selectFeedEvents', () => {
  it('shows an event exactly at the playhead as freshest (distanceFraction 0)', () => {
    const a = event('a', { tMin: 500, tMax: 500 })
    const { visible } = selectFeedEvents([a], 500)
    expect(visible).toEqual([{ event: a, distanceFraction: 0, members: [a] }])
  })

  it('excludes an event ahead of the playhead — it has not happened yet from this vantage', () => {
    const future = event('future', { tMin: 400, tMax: 400 })
    const { visible } = selectFeedEvents([future], 500)
    expect(visible).toEqual([])
  })

  it('is pure in t: revisiting the same t reproduces the exact same feed regardless of how it is reached', () => {
    const events = [event('a', { tMin: 480, tMax: 480 }), event('b', { tMin: 300, tMax: 300 })]
    const first = selectFeedEvents(events, 490)
    const second = selectFeedEvents([...events].reverse(), 490)
    expect(second).toEqual(first)
  })

  it('bounds the lookback evenly across eras: the same ratio spans far fewer years near the present than in deep time', () => {
    const yearsBehind = 5e5
    const nearPresent = selectFeedEvents([event('e', { tMin: 100 + yearsBehind, tMax: 100 + yearsBehind })], 100)
    const deepTime = selectFeedEvents([event('e', { tMin: 3e9 + yearsBehind, tMax: 3e9 + yearsBehind })], 3e9)

    expect(nearPresent.visible).toEqual([])
    expect(deepTime.visible).toHaveLength(1)
  })

  it("refuses to fill an empty slot from beyond the lookback: 200 years ago does not reach the Neolithic", () => {
    const newcomen = event('newcomen', { tMin: 313, tMax: 313 })
    const neolithic = event('neolithic', { tMin: 9000, tMax: 9000 })
    const { visible } = selectFeedEvents([newcomen, neolithic], 200)
    expect(ids(visible)).toEqual(['newcomen'])
  })

  it('reports distanceFraction as the relative-age fraction, 1 exactly at FRESH_AGE_RATIO', () => {
    const e = event('e', { tMin: 175, tMax: 175 })
    const { visible } = selectFeedEvents([e], 75)
    expect(visible).toEqual([{ event: e, distanceFraction: 1, members: [e] }])
  })

  it('keeps a lone card the feed still has room for, long after it has aged past the freshness scale', () => {
    const lone = event('lone', { tMin: 315_000, tMax: 315_000 })
    const { visible } = selectFeedEvents([lone], 130_000)
    expect(ids(visible)).toEqual(['lone'])
    expect(visible[0]!.distanceFraction).toBeGreaterThan(1)
  })

  // Far enough apart that each stays its own cluster.
  const FAR_APART = [510, 650, 900, 1300] as const

  it('holds the same cards as t advances while no newer event arrives to replace them', () => {
    const events = [
      event('a', { tMin: FAR_APART[0], tMax: FAR_APART[0] }),
      event('b', { tMin: FAR_APART[1], tMax: FAR_APART[1] }),
      event('c', { tMin: FAR_APART[2], tMax: FAR_APART[2] }),
    ]
    expect(ids(selectFeedEvents(events, 500).visible)).toEqual(['a', 'b', 'c'])
    expect(ids(selectFeedEvents(events, 200).visible)).toEqual(['a', 'b', 'c'])
  })

  it('drops the oldest card only once a newer event arrives to take the slot', () => {
    const standing = [
      event('a', { tMin: FAR_APART[0], tMax: FAR_APART[0] }),
      event('b', { tMin: FAR_APART[1], tMax: FAR_APART[1] }),
      event('c', { tMin: FAR_APART[2], tMax: FAR_APART[2] }),
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
      event('e1', { tMin: FAR_APART[0], tMax: FAR_APART[0] }),
      event('e2', { tMin: FAR_APART[1], tMax: FAR_APART[1] }),
      event('e3', { tMin: FAR_APART[2], tMax: FAR_APART[2] }),
      event('e4', { tMin: FAR_APART[3], tMax: FAR_APART[3] }),
    ]
    const { visible } = selectFeedEvents(events, 500, { maxVisible: 2 })
    expect(ids(visible)).toEqual(['e1', 'e2'])
  })

  it('collapses a burst of near-simultaneous events into one digest cluster', () => {
    const burst = ['x1', 'x2', 'x3', 'x4', 'x5'].map((id, i) => event(id, { tMin: 500 + i * 1e-4, tMax: 500 + i * 1e-4 }))
    const { visible } = selectFeedEvents(burst, 500)
    expect(visible).toHaveLength(1)
    expect(memberIds(visible)).toEqual(['x1', 'x2', 'x3', 'x4', 'x5'])
  })

  it('grows a digest monotonically as more of its cluster is reached, never dropping a member already shown', () => {
    // Close enough to cluster, far enough apart to be reached one at a time.
    const oldest = event('oldest', { tMin: 110, tMax: 110 })
    const middle = event('middle', { tMin: 105, tMax: 105 })
    const freshest = event('freshest', { tMin: 100, tMax: 100 })
    const cluster = [oldest, middle, freshest]

    const atOldestOnly = selectFeedEvents(cluster, 110)
    expect(atOldestOnly.visible).toHaveLength(1)
    expect(memberIds(atOldestOnly.visible)).toEqual(['oldest'])

    const atTwo = selectFeedEvents(cluster, 105)
    expect(memberIds(atTwo.visible)).toEqual(['middle', 'oldest'])

    const atAllThree = selectFeedEvents(cluster, 100)
    expect(memberIds(atAllThree.visible)).toEqual(['freshest', 'middle', 'oldest'])
    expect(atAllThree.visible).toHaveLength(1)
  })

  it('within a cluster, breaks an exact placement tie by importance, then by id, for the headline member', () => {
    const low = event('low', { tMin: 510, tMax: 510, importance: 0.2 })
    const high = event('high', { tMin: 510, tMax: 510, importance: 0.9 })
    const byImportance = selectFeedEvents([low, high], 500)
    expect(byImportance.visible).toHaveLength(1) // an exact tie in placement always merges
    expect(byImportance.visible[0]!.event.id).toBe('high')
    expect(memberIds(byImportance.visible)).toEqual(['high', 'low'])

    const b = event('b', { tMin: 510, tMax: 510, importance: 0.5 })
    const a = event('a', { tMin: 510, tMax: 510, importance: 0.5 })
    const byId = selectFeedEvents([b, a], 500)
    expect(byId.visible[0]!.event.id).toBe('a')
  })

  it('returns nothing for a lookback ratio of 1 or no visible slots', () => {
    const a = event('a', { tMin: 500, tMax: 500 })
    expect(selectFeedEvents([a], 500, { lookbackAgeRatio: 1 })).toEqual({ visible: [] })
    expect(selectFeedEvents([a], 500, { maxVisible: 0 })).toEqual({ visible: [] })
  })

})
