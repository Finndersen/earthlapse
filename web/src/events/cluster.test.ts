import { describe, expect, it } from 'vitest'

import type { TimelineEvent } from '@/types/layer'

import { CLUSTER_SPAN, clusterEvents } from './cluster'

function event(id: string, overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id, label: id, tMin: 0, tMax: 0, importance: 0.5, description: '', citation: '', ...overrides }
}

function memberIds(clusters: { members: readonly TimelineEvent[] }[]): string[][] {
  return clusters.map((c) => c.members.map((m) => m.id))
}

describe('clusterEvents', () => {
  it('keeps two events apart when their gap is at or above CLUSTER_SPAN', () => {
    const gapT = (100 + 25) * 2 ** (CLUSTER_SPAN + 0.01) - 25
    const events = [event('older', { tMin: gapT, tMax: gapT }), event('newer', { tMin: 100, tMax: 100 })]
    expect(memberIds(clusterEvents(events))).toEqual([['newer'], ['older']])
  })

  it('merges two events when their gap is below CLUSTER_SPAN', () => {
    const gapT = (100 + 25) * 2 ** (CLUSTER_SPAN - 0.01) - 25
    const events = [event('older', { tMin: gapT, tMax: gapT }), event('newer', { tMin: 100, tMax: 100 })]
    expect(memberIds(clusterEvents(events))).toEqual([['newer', 'older']])
  })

  it("never lets a cluster's total span reach CLUSTER_SPAN, even though every adjacent step inside it does not", () => {
    const step = 106.25 / 100 // the ratio used above, ~1.0868x below (100+25) terms
    const ts: number[] = [100]
    for (let i = 1; i < 20; i++) ts.push((ts[i - 1]! + 25) * step - 25)
    const events = ts.map((t, i) => event(`e${i}`, { tMin: t, tMax: t }))

    for (const cluster of clusterEvents(events)) {
      const placements = cluster.members.map((m) => m.tMin)
      const span = Math.log2((Math.max(...placements) + 25) / (Math.min(...placements) + 25))
      expect(span).toBeLessThan(CLUSTER_SPAN)
    }
  })

  it('partitions independently of t, memoised by array identity', () => {
    const events = [event('a', { tMin: 500, tMax: 500 }), event('b', { tMin: 500.01, tMax: 500.01 }), event('c', { tMin: 900, tMax: 900 })]
    const first = clusterEvents(events)
    const second = clusterEvents(events)
    expect(memberIds(first)).toEqual([
      ['a', 'b'],
      ['c'],
    ])
    expect(second).toBe(first) // memoised by array identity — not merely equal, the same reference
  })

  it('orders cluster members freshest first (ascending placement)', () => {
    const oldest = event('oldest', { tMin: 110, tMax: 110 })
    const freshest = event('freshest', { tMin: 100, tMax: 100 })
    const middle = event('middle', { tMin: 105, tMax: 105 })
    expect(memberIds(clusterEvents([oldest, freshest, middle]))).toEqual([['freshest', 'middle', 'oldest']])
  })

  it('breaks an exact placement tie by importance (higher first), then by id', () => {
    const low = event('low', { tMin: 500, tMax: 500, importance: 0.2 })
    const high = event('high', { tMin: 500, tMax: 500, importance: 0.9 })
    expect(memberIds(clusterEvents([low, high]))).toEqual([['high', 'low']])

    const b = event('b', { tMin: 500, tMax: 500, importance: 0.5 })
    const a = event('a', { tMin: 500, tMax: 500, importance: 0.5 })
    expect(memberIds(clusterEvents([b, a]))).toEqual([['a', 'b']])
  })

})
