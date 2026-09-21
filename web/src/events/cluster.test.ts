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
    // Chosen so the log2 gap lands just above CLUSTER_SPAN: 2^CLUSTER_SPAN * (100 + 25) - 25.
    const gapT = (100 + 25) * 2 ** (CLUSTER_SPAN + 0.01) - 25
    const events = [event('older', { tMin: gapT, tMax: gapT }), event('newer', { tMin: 100, tMax: 100 })]
    expect(memberIds(clusterEvents(events))).toEqual([['newer'], ['older']])
  })

  it('merges two events when their gap is below CLUSTER_SPAN', () => {
    const gapT = (100 + 25) * 2 ** (CLUSTER_SPAN - 0.01) - 25
    const events = [event('older', { tMin: gapT, tMax: gapT }), event('newer', { tMin: 100, tMax: 100 })]
    expect(memberIds(clusterEvents(events))).toEqual([['newer', 'older']])
  })

  it('bounds a cluster by its total extent, not only its adjacent gaps: a chain of small steps still splits once it runs past CLUSTER_SPAN end to end', () => {
    // Each step's own gap is 0.6x CLUSTER_SPAN (comfortably under it on its own), but two
    // consecutive steps combined exceed it. Single-linkage on adjacent gaps alone would chain
    // these without limit — the real bug this bounds: a long dense run (the published manifest's
    // mid-20th-century stretch, under an earlier draft of this threshold) chained into one
    // 27-member digest whose own total span was ~8x CLUSTER_SPAN, defeating the dwell fix by
    // hiding a whole era behind one ever-growing badge instead of giving individual cards time to
    // be read. Every event here still joins *some* cluster — nothing is ever dropped — but the
    // chain splits every second step, once the total span back to the current cluster's own first
    // member would clear CLUSTER_SPAN (0.6x -> 1.2x crosses it every other step).
    const stepRatio = 2 ** (CLUSTER_SPAN * 0.6)
    const ts: number[] = [100]
    for (let i = 1; i < 5; i++) ts.push((ts[i - 1]! + 25) * stepRatio - 25)
    const events = ts.map((t, i) => event(`e${i}`, { tMin: t, tMax: t }))
    expect(memberIds(clusterEvents(events))).toEqual([['e0', 'e1'], ['e2', 'e3'], ['e4']])
  })

  it("never lets a cluster's total span reach CLUSTER_SPAN, even though every adjacent step inside it does not", () => {
    // A longer chain of the same small step, to check the bound holds generally rather than
    // only at the specific length above.
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

  it('is independent of t: membership never takes a playhead, and never changes across two identical calls', () => {
    const events = [event('a', { tMin: 500, tMax: 500 }), event('b', { tMin: 500.01, tMax: 500.01 }), event('c', { tMin: 900, tMax: 900 })]
    const first = clusterEvents(events)
    const second = clusterEvents(events)
    expect(memberIds(first)).toEqual([
      ['a', 'b'],
      ['c'],
    ])
    expect(second).toBe(first) // memoised by array identity — not merely equal, the same reference
  })

  it('recomputes (but reproduces the same partition) for a different array with the same events', () => {
    const events = [event('a', { tMin: 500, tMax: 500 }), event('b', { tMin: 505, tMax: 505 })]
    const first = clusterEvents(events)
    const second = clusterEvents([...events])
    expect(second).not.toBe(first)
    expect(memberIds(second)).toEqual(memberIds(first))
  })

  it('orders cluster members freshest first (ascending placement)', () => {
    const oldest = event('oldest', { tMin: 110, tMax: 110 })
    const freshest = event('freshest', { tMin: 100, tMax: 100 })
    const middle = event('middle', { tMin: 105, tMax: 105 })
    // Deliberately unsorted input — clustering sorts internally.
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

  it('returns one singleton cluster per event when nothing is close enough to merge', () => {
    const events = [event('a', { tMin: 100, tMax: 100 }), event('b', { tMin: 1000, tMax: 1000 }), event('c', { tMin: 10_000, tMax: 10_000 })]
    expect(memberIds(clusterEvents(events))).toEqual([['a'], ['b'], ['c']])
  })

  it('returns an empty partition for an empty event list', () => {
    expect(clusterEvents([])).toEqual([])
  })

  it('handles a single event as one singleton cluster', () => {
    const solo = event('solo')
    expect(memberIds(clusterEvents([solo]))).toEqual([['solo']])
  })
})
