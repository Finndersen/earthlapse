import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION, type TimelineEvent } from '@/types/layer'

import type { TimelineCheckpoint } from './checkpoints'
import {
  findLoupeSnapTarget,
  loupeCandidates,
  loupePosition,
  loupeScale,
  loupeWindow,
  LOUPE_HEIGHT_PX,
  LOUPE_MAGNIFICATION,
  LOUPE_SNAP_PX,
  LOUPE_VIEWPORT_MARGIN_PX,
  LOUPE_WIDTH_PX,
} from './loupe'
import type { TimeWindow } from './scale'
import { MIN_SPAN_YEARS } from './zoom'

describe('loupeWindow', () => {
  it('is 1/LOUPE_MAGNIFICATION of the main window span, centred on the cursor', () => {
    const main: TimeWindow = [0, 1.2e8]
    const cursorT = 6e7
    const [newest, oldest] = loupeWindow(main, cursorT)
    expect(oldest - newest).toBeCloseTo(1.2e8 / LOUPE_MAGNIFICATION, 3)
    expect((newest + oldest) / 2).toBeCloseTo(cursorT, 3)
  })

  it('never renders narrower than MIN_SPAN_YEARS even for a tiny main window', () => {
    const main: TimeWindow = [1e6, 1e6 + 1]
    const [newest, oldest] = loupeWindow(main, 1e6)
    expect(oldest - newest).toBeGreaterThanOrEqual(MIN_SPAN_YEARS)
  })

  it('slides rather than shrinks at the present edge', () => {
    const main: TimeWindow = [0, 1.2e8]
    const [newest, oldest] = loupeWindow(main, 0)
    expect(newest).toBe(0)
    expect(oldest - newest).toBeCloseTo(1.2e8 / LOUPE_MAGNIFICATION, 3)
  })

  it('slides rather than shrinks at the oldest edge', () => {
    const main: TimeWindow = [0, 1.2e8]
    const [newest, oldest] = loupeWindow(main, EARTH_FORMATION)
    expect(oldest).toBe(EARTH_FORMATION)
    expect(oldest - newest).toBeCloseTo(1.2e8 / LOUPE_MAGNIFICATION, 3)
  })

  it('stays within the domain for a cursor time outside it', () => {
    const [newest, oldest] = loupeWindow([0, 1e8], -50)
    expect(newest).toBeGreaterThanOrEqual(0)
    expect(oldest).toBeGreaterThanOrEqual(newest)
  })
})

describe('loupeCandidates', () => {
  const events: TimelineEvent[] = [
    { id: 'e1', label: 'Inside', tMin: 90, tMax: 110, importance: 0.01, description: '', citation: '' },
    { id: 'e2', label: 'Outside', tMin: 900, tMax: 1000, importance: 0.01, description: '', citation: '' },
  ]
  const checkpoints: TimelineCheckpoint[] = [
    { id: 'c1', t: 105, label: 'Checkpoint inside' },
    { id: 'c2', t: 900, label: 'Checkpoint outside' },
  ]

  it('includes low-importance events the main track LOD would hide, when they overlap the window', () => {
    const result = loupeCandidates(events, [], [0, 200])
    expect(result.map((c) => c.id)).toEqual(['e1'])
  })

  it('uses the uncertainty-band midpoint as an event candidate\'s time', () => {
    const [candidate] = loupeCandidates(events, [], [0, 200])
    expect(candidate!.t).toBe(100)
  })

  it('includes checkpoints inside the window and excludes ones outside it', () => {
    const result = loupeCandidates([], checkpoints, [0, 200])
    expect(result.map((c) => c.id)).toEqual(['c1'])
  })

  it('sorts the combined candidates by time', () => {
    const result = loupeCandidates(events, checkpoints, [0, 2000])
    expect(result.map((c) => c.t)).toEqual([...result.map((c) => c.t)].sort((a, b) => a - b))
  })
})

describe('findLoupeSnapTarget', () => {
  const window: TimeWindow = [0, 1000]
  const scale = loupeScale(window)
  const widthPx = LOUPE_WIDTH_PX

  it('snaps to a candidate within LOUPE_SNAP_PX of the cursor', () => {
    const candidates = [{ id: 'a', t: 500, label: 'A', kind: 'checkpoint' as const }]
    // 500/1000 * 240px = 120px; put the cursor 5px away in time-space.
    const cursorT = 500 - (5 / widthPx) * 1000
    const target = findLoupeSnapTarget(candidates, scale, cursorT, widthPx)
    expect(target?.id).toBe('a')
  })

  it('does not snap to a candidate further than LOUPE_SNAP_PX away', () => {
    const candidates = [{ id: 'a', t: 500, label: 'A', kind: 'checkpoint' as const }]
    const cursorT = 500 - (30 / widthPx) * 1000
    expect(findLoupeSnapTarget(candidates, scale, cursorT, widthPx)).toBeUndefined()
  })

  it('picks the nearest candidate when several are within range', () => {
    const candidates = [
      { id: 'near', t: 500, label: 'Near', kind: 'checkpoint' as const },
      { id: 'far', t: 505, label: 'Far', kind: 'checkpoint' as const },
    ]
    const target = findLoupeSnapTarget(candidates, scale, 500, widthPx)
    expect(target?.id).toBe('near')
  })

  it('returns undefined for an empty candidate list', () => {
    expect(findLoupeSnapTarget([], scale, 500, widthPx)).toBeUndefined()
  })

  it('respects a custom snapPx', () => {
    const candidates = [{ id: 'a', t: 500, label: 'A', kind: 'checkpoint' as const }]
    const cursorT = 500 - (3 / widthPx) * 1000
    expect(findLoupeSnapTarget(candidates, scale, cursorT, widthPx, 1)).toBeUndefined()
    expect(findLoupeSnapTarget(candidates, scale, cursorT, widthPx, 5)).toBeDefined()
  })
})

describe('loupePosition', () => {
  it('centres horizontally over the cursor and floats above it when there is room', () => {
    const pos = loupePosition(700, 500, 1440, 900)
    expect(pos.left).toBeCloseTo(700 - LOUPE_WIDTH_PX / 2, 6)
    expect(pos.top).toBeLessThan(500)
  })

  it('clamps to the left viewport edge', () => {
    const pos = loupePosition(5, 500, 1440, 900)
    expect(pos.left).toBe(LOUPE_VIEWPORT_MARGIN_PX)
  })

  it('clamps to the right viewport edge', () => {
    const pos = loupePosition(1435, 500, 1440, 900)
    expect(pos.left).toBeLessThanOrEqual(1440 - LOUPE_WIDTH_PX - LOUPE_VIEWPORT_MARGIN_PX + 1e-6)
  })

  it('clamps to the top viewport edge when the cursor is near the top', () => {
    const pos = loupePosition(700, 5, 1440, 900)
    expect(pos.top).toBe(LOUPE_VIEWPORT_MARGIN_PX)
  })

  it('never produces a position outside the viewport for a narrow viewport', () => {
    const pos = loupePosition(200, 400, 400, 850)
    expect(pos.left).toBeGreaterThanOrEqual(0)
    expect(pos.left + LOUPE_WIDTH_PX).toBeLessThanOrEqual(400 + 1e-6)
    expect(pos.top).toBeGreaterThanOrEqual(0)
    expect(pos.top + LOUPE_HEIGHT_PX).toBeLessThanOrEqual(850 + 1e-6)
  })
})
