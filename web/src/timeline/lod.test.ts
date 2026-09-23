import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type TimelineEvent } from '@/types/layer'

import { nearestNeighbourEvent } from './lod'
import type { TimeWindow } from './scale'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]

function event(id: string, tMin: number, tMax: number, importance: number): TimelineEvent {
  return { id, label: id, tMin, tMax, importance, description: '', citation: '' }
}

describe('nearestNeighbourEvent', () => {
  const majorExtinction = event('extinction', 2.5e8, 2.52e8, 1.0)
  const minorEvent = event('minor', 1e5, 1.001e5, 0.3)

  it('reaches a low-importance event as readily as a high-importance one', () => {
    // Stepping reaches every event overlapping the window regardless of how low its importance is.
    expect(nearestNeighbourEvent([majorExtinction, minorEvent], FULL_DOMAIN, 0, 'back')?.id).toBe('minor')
  })

  it('finds the nearest event further into the past (back)', () => {
    expect(nearestNeighbourEvent([majorExtinction, minorEvent], FULL_DOMAIN, 2e8, 'back')?.id).toBe('extinction')
  })

  it('returns undefined when there is no event in that direction', () => {
    expect(nearestNeighbourEvent([majorExtinction], FULL_DOMAIN, 2.6e8, 'back')).toBeUndefined()
    expect(nearestNeighbourEvent([majorExtinction], FULL_DOMAIN, 2e8, 'forward')).toBeUndefined()
  })

  it('excludes events whose uncertainty band does not overlap the window', () => {
    const window: TimeWindow = [0, 1e3]
    expect(nearestNeighbourEvent([majorExtinction, minorEvent], window, 500, 'back')).toBeUndefined()
  })

})
