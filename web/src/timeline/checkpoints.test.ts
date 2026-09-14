import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type TimelineEvent } from '@/types/layer'

import { nearestNeighbourCheckpoint, nearestStepTarget, visibleCheckpoints, type TimelineCheckpoint } from './checkpoints'
import type { TimeWindow } from './scale'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]

function checkpoint(id: string, t: number): TimelineCheckpoint {
  return { id, t, label: id }
}

function event(id: string, tMin: number, tMax: number, importance: number): TimelineEvent {
  return { id, label: id, tMin, tMax, importance, description: '', citation: '' }
}

describe('visibleCheckpoints', () => {
  it('keeps every checkpoint inside the window regardless of importance (there is none)', () => {
    const checkpoints = [checkpoint('a', 20000), checkpoint('b', 9000), checkpoint('c', 0)]
    expect(visibleCheckpoints(checkpoints, FULL_DOMAIN).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('excludes checkpoints outside the window', () => {
    const checkpoints = [checkpoint('inside', 5000), checkpoint('outside', 5e8)]
    const shown = visibleCheckpoints(checkpoints, [0, 1e4])
    expect(shown.map((c) => c.id)).toEqual(['inside'])
  })

  it('includes a checkpoint exactly on a window edge', () => {
    const checkpoints = [checkpoint('edge', 1e4)]
    expect(visibleCheckpoints(checkpoints, [0, 1e4]).map((c) => c.id)).toEqual(['edge'])
  })
})

describe('nearestNeighbourCheckpoint', () => {
  const checkpoints = [checkpoint('old', 3e8), checkpoint('mid', 1e6), checkpoint('recent', 1e4)]

  it('finds the nearest checkpoint further into the past (back)', () => {
    expect(nearestNeighbourCheckpoint(checkpoints, FULL_DOMAIN, 5e5, 'back')?.id).toBe('mid')
  })

  it('finds the nearest checkpoint toward the present (forward)', () => {
    expect(nearestNeighbourCheckpoint(checkpoints, FULL_DOMAIN, 5e5, 'forward')?.id).toBe('recent')
  })

  it('returns undefined when there is no checkpoint in that direction', () => {
    expect(nearestNeighbourCheckpoint(checkpoints, FULL_DOMAIN, 3e8, 'back')).toBeUndefined()
    expect(nearestNeighbourCheckpoint(checkpoints, FULL_DOMAIN, 1e4, 'forward')).toBeUndefined()
  })

  it('ignores checkpoints outside the visible window', () => {
    const window: TimeWindow = [0, 2e6]
    expect(nearestNeighbourCheckpoint(checkpoints, window, 5e5, 'back')?.id).toBe('mid')
    expect(nearestNeighbourCheckpoint(checkpoints, window, 2e6, 'back')).toBeUndefined()
  })
})

describe('nearestStepTarget', () => {
  const checkpoints = [checkpoint('pleistocene-steppe', 20000)]
  const events = [event('agriculture', 12000, 11000, 1.0)]

  it('steps to the nearest event when there are no checkpoints to compare against', () => {
    const target = nearestStepTarget(events, [], FULL_DOMAIN, 5000, 'back')
    expect(target).toBe((11000 + 12000) / 2)
  })

  it('steps to whichever of the nearest event or nearest checkpoint is actually closer, back', () => {
    // Nearest event midpoint (11500) is closer than the checkpoint (20000) when stepping back
    // from t=5000.
    expect(nearestStepTarget(events, checkpoints, FULL_DOMAIN, 5000, 'back')).toBe(11500)
  })

  it('steps to whichever of the nearest event or nearest checkpoint is actually closer, forward', () => {
    // From t=30000, stepping forward: the checkpoint (20000) is closer to the present than
    // the event midpoint (11500).
    expect(nearestStepTarget(events, checkpoints, FULL_DOMAIN, 30000, 'forward')).toBe(20000)
  })

  it('reaches a checkpoint that has no event near it at all', () => {
    expect(nearestStepTarget([], checkpoints, FULL_DOMAIN, 30000, 'forward')).toBe(20000)
  })

  it('reaches an event when there are no checkpoints at all', () => {
    expect(nearestStepTarget(events, [], FULL_DOMAIN, 30000, 'forward')).toBe(11500)
  })

  it('returns undefined when neither set has a candidate in that direction', () => {
    expect(nearestStepTarget([], [], FULL_DOMAIN, 5000, 'back')).toBeUndefined()
  })

  it('makes every checkpoint reachable by stepping through a cluster near the present', () => {
    // Regression: pleistocene-steppe (20000), neolithic-river-settlement (9000) and
    // modern-city (0) must each be individually reachable by repeated forward steps from the
    // oldest end of the domain, with no events in the way.
    const cluster = [checkpoint('pleistocene-steppe', 20000), checkpoint('neolithic-river-settlement', 9000), checkpoint('modern-city', 0)]
    let t = EARTH_FORMATION
    const visited: number[] = []
    for (let i = 0; i < 3; i++) {
      const next = nearestStepTarget([], cluster, FULL_DOMAIN, t, 'forward')
      expect(next).toBeDefined()
      visited.push(next as number)
      t = next as number
    }
    expect(visited).toEqual([20000, 9000, 0])
  })
})
