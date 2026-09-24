import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { nearestNeighbourCheckpoint, nearestStepTarget, transportStepTarget, visibleCheckpoints, type TimelineCheckpoint } from './checkpoints'
import type { TimeWindow } from './scale'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]

function checkpoint(id: string, t: number): TimelineCheckpoint {
  return { id, t, label: id }
}

describe('visibleCheckpoints', () => {
  it('keeps every checkpoint inside the window', () => {
    const checkpoints = [checkpoint('a', 20000), checkpoint('b', 9000), checkpoint('c', 0)]
    expect(visibleCheckpoints(checkpoints, FULL_DOMAIN).map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('excludes checkpoints outside the window', () => {
    const checkpoints = [checkpoint('inside', 5000), checkpoint('outside', 5e8)]
    const shown = visibleCheckpoints(checkpoints, [0, 1e4])
    expect(shown.map((c) => c.id)).toEqual(['inside'])
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

  it('steps to the nearest checkpoint in either direction', () => {
    expect(nearestStepTarget(checkpoints, FULL_DOMAIN, 5000, 'back')).toBe(20000)
    expect(nearestStepTarget(checkpoints, FULL_DOMAIN, 30000, 'forward')).toBe(20000)
    expect(nearestStepTarget([], FULL_DOMAIN, 5000, 'back')).toBeUndefined()
  })

  it('reaches every checkpoint of a cluster near the present by repeated forward steps', () => {
    const cluster = [checkpoint('pleistocene-steppe', 20000), checkpoint('neolithic-river-settlement', 9000), checkpoint('modern-city', 0)]
    let t = EARTH_FORMATION
    const visited: number[] = []
    for (let i = 0; i < 3; i++) {
      const next = nearestStepTarget(cluster, FULL_DOMAIN, t, 'forward')
      expect(next).toBeDefined()
      visited.push(next as number)
      t = next as number
    }
    expect(visited).toEqual([20000, 9000, 0])
  })
})

describe('transportStepTarget', () => {
  const checkpoints = [checkpoint('pleistocene-steppe', 20000)]

  it('steps to a scene in scenes mode and by one second of playback in steady mode, clamped to the window', () => {
    expect(transportStepTarget(checkpoints, FULL_DOMAIN, 5000, 'back', { mode: 'scenes', yearsPerSecond: 100 })).toBe(20000)
    const steady = { mode: 'steady', yearsPerSecond: 100 } as const
    expect(transportStepTarget(checkpoints, FULL_DOMAIN, 5000, 'back', steady)).toBe(5100)
    expect(transportStepTarget(checkpoints, FULL_DOMAIN, 5000, 'forward', steady)).toBe(4900)
    expect(transportStepTarget(checkpoints, FULL_DOMAIN, 50, 'forward', steady)).toBe(0)
    expect(transportStepTarget(checkpoints, FULL_DOMAIN, 0, 'forward', steady)).toBeUndefined()
  })
})
