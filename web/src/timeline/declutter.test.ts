import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type TimelineEvent } from '@/types/layer'

import { declutterEvents } from './declutter'
import { fisheyeScale, type FisheyeLens } from './fisheye'
import { createLinearScale, createSymlogScale, type TimeWindow } from './scale'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]
const FULL_DOMAIN_SCALE = createSymlogScale(FULL_DOMAIN)

function event(id: string, tMin: number, tMax: number, importance: number): TimelineEvent {
  return { id, label: id, tMin, tMax, importance, description: '', citation: '' }
}

function ids(events: readonly TimelineEvent[]): string[] {
  return events.map((e) => e.id)
}

describe('declutterEvents', () => {
  describe('room-based selection', () => {
    it('draws a low- and a high-importance event side by side when neither collides with the other', () => {
      const lomekwi = event('lomekwi-stone-tools', 3.25e6, 3.35e6, 0.6)
      const kpgExtinction = event('kpg-extinction', 6.6e7, 6.602e7, 1.0)
      const shown = declutterEvents([lomekwi, kpgExtinction], FULL_DOMAIN, FULL_DOMAIN_SCALE, 1440)
      expect(ids(shown).sort()).toEqual(['kpg-extinction', 'lomekwi-stone-tools'])
    })
  })

  // px(t) = 1000 - t on this linear window and track.
  const EXACT_WINDOW: TimeWindow = [0, 1000]
  const EXACT_SCALE = createLinearScale(EXACT_WINDOW)
  const EXACT_TRACK_PX = 1000

  describe('collisions keep the higher-importance event', () => {
    it('drops the lower-importance event when their displayed bands collide', () => {
      const high = event('high', 500, 500, 1.0)
      const low = event('low', 498, 498, 0.3)
      const shown = declutterEvents([high, low], EXACT_WINDOW, EXACT_SCALE, EXACT_TRACK_PX)
      expect(ids(shown)).toEqual(['high'])
    })

    it('draws both when their displayed bands do not collide', () => {
      const a = event('a', 500, 500, 1.0)
      const b = event('b', 450, 450, 0.1)
      const shown = declutterEvents([a, b], EXACT_WINDOW, EXACT_SCALE, EXACT_TRACK_PX)
      expect(ids(shown).sort()).toEqual(['a', 'b'])
    })
  })

  describe('deterministic tie-breaking', () => {
    it('keeps the narrower band when importance ties', () => {
      const wide = event('wide', 500, 520, 0.5)
      const narrow = event('narrow', 505, 507, 0.5)
      expect(ids(declutterEvents([wide, narrow], EXACT_WINDOW, EXACT_SCALE, EXACT_TRACK_PX))).toEqual(['narrow'])
      expect(ids(declutterEvents([narrow, wide], EXACT_WINDOW, EXACT_SCALE, EXACT_TRACK_PX))).toEqual(['narrow'])
    })

    it('falls back to id when importance and band width both tie', () => {
      const zulu = event('zulu', 500, 500, 0.4)
      const alpha = event('alpha', 500, 500, 0.4)
      const shown = declutterEvents([zulu, alpha], EXACT_WINDOW, EXACT_SCALE, EXACT_TRACK_PX)
      expect(ids(shown)).toEqual(['alpha'])
    })

  })

  it('returns events in time order regardless of acceptance order', () => {
    const oldest = event('oldest', 900, 900, 0.2)
    const newest = event('newest', 100, 100, 0.9)
    const middle = event('middle', 500, 500, 0.5)
    const shown = declutterEvents([oldest, newest, middle], EXACT_WINDOW, EXACT_SCALE, EXACT_TRACK_PX)
    expect(ids(shown)).toEqual(['newest', 'middle', 'oldest'])
  })

  describe('minimum marker width for point (zero-width band) events', () => {
    it('still collides two nearby point events, even though their raw bands have zero width', () => {
      const high = event('high', 500, 500, 1.0)
      const low = event('low', 497, 497, 0.2)
      expect(low.tMax - low.tMin).toBe(0)
      const shown = declutterEvents([high, low], EXACT_WINDOW, EXACT_SCALE, EXACT_TRACK_PX)
      expect(ids(shown)).toEqual(['high'])
    })

  })

  describe('window overlap', () => {
    it('excludes events whose uncertainty band does not overlap the window', () => {
      const outside = event('outside', 2000, 2001, 1.0)
      const shown = declutterEvents([outside], EXACT_WINDOW, EXACT_SCALE, EXACT_TRACK_PX)
      expect(shown).toEqual([])
    })

    it('includes an event whose band only partially overlaps the window edge', () => {
      const straddling = event('straddling', 900, 1100, 1.0)
      const shown = declutterEvents([straddling], EXACT_WINDOW, EXACT_SCALE, EXACT_TRACK_PX)
      expect(ids(shown)).toEqual(['straddling'])
    })
  })

  it('draws every overlapping event, unfiltered by collision, when trackWidthPx is not yet measured', () => {
    const a = event('a', 500, 500, 1.0)
    const b = event('b', 500, 500, 0.1)
    const shown = declutterEvents([a, b], EXACT_WINDOW, EXACT_SCALE, 0)
    expect(ids(shown).sort()).toEqual(['a', 'b'])
  })

  describe('under a fisheye lens', () => {
    // Five point events ~4px apart: they collide at rest.
    const LENS_TRACK_PX = 1440
    const crowd = [500, 503, 506, 509, 512].map((t, i) => event(`e${i}`, t, t, 0.5 - i * 0.01))

    it('reveals more of the crowd once a lens focused over it stretches their bands apart', () => {
      const atRest = declutterEvents(crowd, EXACT_WINDOW, EXACT_SCALE, LENS_TRACK_PX)
      const lens: FisheyeLens = { centreU: EXACT_SCALE.toUnit(506), strength: 1 }
      const stretched = fisheyeScale(EXACT_SCALE, lens, LENS_TRACK_PX)
      const underLens = declutterEvents(crowd, EXACT_WINDOW, stretched, LENS_TRACK_PX)
      expect(underLens.length).toBeGreaterThan(atRest.length)
      expect(atRest.length).toBeLessThan(crowd.length)
      expect(underLens.length).toBeLessThanOrEqual(crowd.length)
    })
  })
})
