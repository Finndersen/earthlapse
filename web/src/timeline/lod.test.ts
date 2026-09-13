import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type TimelineEvent } from '@/types/layer'

import { minImportanceForSpan, visibleEvents } from './lod'
import type { TimeWindow } from './scale'
import { MIN_SPAN_YEARS } from './zoom'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]

function event(id: string, tMin: number, tMax: number, importance: number): TimelineEvent {
  return { id, label: id, tMin, tMax, importance, description: '', citation: '' }
}

describe('minImportanceForSpan', () => {
  it('is monotone: a wider span never lowers the threshold', () => {
    const spans = [MIN_SPAN_YEARS, 1e2, 1e4, 1e6, 1e8, EARTH_FORMATION]
    let previous = -Infinity
    for (const span of spans) {
      const threshold = minImportanceForSpan(span)
      expect(threshold).toBeGreaterThanOrEqual(previous)
      previous = threshold
    }
  })

  it('is close to 0 at the narrowest span and close to 1 at the full domain', () => {
    expect(minImportanceForSpan(MIN_SPAN_YEARS)).toBeCloseTo(0, 6)
    expect(minImportanceForSpan(EARTH_FORMATION)).toBeCloseTo(1, 6)
  })

  it('clamps spans outside [MIN_SPAN_YEARS, EARTH_FORMATION]', () => {
    expect(minImportanceForSpan(0)).toBe(minImportanceForSpan(MIN_SPAN_YEARS))
    expect(minImportanceForSpan(EARTH_FORMATION * 10)).toBe(minImportanceForSpan(EARTH_FORMATION))
  })
})

describe('visibleEvents', () => {
  const majorExtinction = event('extinction', 2.5e8, 2.52e8, 1.0)
  const minorEvent = event('minor', 1e5, 1.001e5, 0.3)

  it('drops low-importance events when zoomed out (wide span)', () => {
    const shown = visibleEvents([majorExtinction, minorEvent], FULL_DOMAIN, EARTH_FORMATION)
    expect(shown.map((e) => e.id)).toEqual(['extinction'])
  })

  it('shows the same low-importance event once zoomed in (narrow span around it)', () => {
    // A 100-year visible span puts the importance floor (log-linear in span) below the
    // minor event's 0.3, where the full-domain span put it above.
    const window: TimeWindow = [1e5, 1e5 + 100]
    const shown = visibleEvents([majorExtinction, minorEvent], window, window[1] - window[0])
    expect(shown.map((e) => e.id)).toEqual(['minor'])
  })

  it('excludes events whose uncertainty band does not overlap the window', () => {
    const window: TimeWindow = [0, 1e3]
    const shown = visibleEvents([majorExtinction, minorEvent], window, window[1] - window[0])
    expect(shown).toEqual([])
  })

  it('includes an event whose band only partially overlaps the window edge', () => {
    const straddling = event('straddling', 900, 1100, 1.0)
    const window: TimeWindow = [0, 1000]
    const shown = visibleEvents([straddling], window, window[1] - window[0])
    expect(shown.map((e) => e.id)).toEqual(['straddling'])
  })
})
