import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { fisheyeScale } from './fisheye'
import { createLinearScale, createSymlogScale, type TimeWindow } from './scale'
import { generateTicks, tickLabelAlign } from './ticks'

const TRACK_WIDTH = 900

const CASES: { name: string; window: TimeWindow; kind: 'symlog' | 'linear' }[] = [
  { name: '1-year span, linear', window: [0, 1], kind: 'linear' },
  { name: '1-year span, symlog', window: [0, 1], kind: 'symlog' },
  { name: 'a decade, linear', window: [0, 10], kind: 'linear' },
  { name: 'a century, symlog', window: [0, 100], kind: 'symlog' },
  { name: 'the Holocene (ka range), symlog', window: [0, 1.17e4], kind: 'symlog' },
  { name: 'Cenozoic (Ma range), symlog', window: [0, 6.6e7], kind: 'symlog' },
  { name: 'mid-domain window far from either edge, symlog', window: [2e8, 2.1e8], kind: 'symlog' },
  { name: 'full domain, symlog', window: [0, EARTH_FORMATION], kind: 'symlog' },
  { name: 'full domain, linear', window: [0, EARTH_FORMATION], kind: 'linear' },
]

describe('generateTicks', () => {
  for (const { name, window, kind } of CASES) {
    it(`produces non-overlapping ticks for: ${name}`, () => {
      const scale = kind === 'symlog' ? createSymlogScale(window) : createLinearScale(window)
      const ticks = generateTicks(window, scale, TRACK_WIDTH)
      expect(ticks.length).toBeGreaterThan(0)
      for (const tick of ticks) {
        expect(tick.t).toBeGreaterThanOrEqual(window[0])
        expect(tick.t).toBeLessThanOrEqual(window[1])
        expect(tick.u).toBeGreaterThanOrEqual(0)
        expect(tick.u).toBeLessThanOrEqual(1)
        expect(tick.label.length).toBeGreaterThan(0)
      }
      const us = ticks.map((t) => t.u)
      expect(new Set(us).size).toBe(us.length)
      assertNoOverlapSimple(ticks, TRACK_WIDTH)
    })
  }

  it('includes a "present" tick when the window touches t=0', () => {
    const window: TimeWindow = [0, 1e8]
    const scale = createSymlogScale(window)
    const ticks = generateTicks(window, scale, TRACK_WIDTH)
    expect(ticks.some((t) => t.label === 'present')).toBe(true)
  })

  it('omits "present" when the window does not include t=0', () => {
    const window: TimeWindow = [1e6, 1e8]
    const scale = createSymlogScale(window)
    const ticks = generateTicks(window, scale, TRACK_WIDTH)
    expect(ticks.some((t) => t.label === 'present')).toBe(false)
  })

  it('returns ticks sorted left to right by u', () => {
    const window: TimeWindow = [0, EARTH_FORMATION]
    const scale = createSymlogScale(window)
    const ticks = generateTicks(window, scale, TRACK_WIDTH)
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!.u).toBeGreaterThanOrEqual(ticks[i - 1]!.u)
    }
  })

  it('produces fewer ticks, not overlapping ones, on a very narrow track', () => {
    const window: TimeWindow = [0, EARTH_FORMATION]
    const scale = createSymlogScale(window)
    const ticks = generateTicks(window, scale, 120)
    assertNoOverlapSimple(ticks, 120)
  })

  it('degrades to no ticks for a non-positive track width', () => {
    const window: TimeWindow = [0, EARTH_FORMATION]
    expect(generateTicks(window, createSymlogScale(window), 0)).toEqual([])
  })

  it('never overlaps the edge-anchored "present" label with its neighbour, even fisheye-stretched near it (regression)', () => {
    // The lens sits right on the present edge (u=1) — exactly where the old centred-half-width
    // collision check under-counted "present"'s own right-aligned span and let it collide with
    // its neighbour. `strength: 1` is the fully-engaged lens, the worst case for stretch.
    const window: TimeWindow = [0, EARTH_FORMATION]
    const base = createSymlogScale(window)
    const stretched = fisheyeScale(base, { centreU: 1, strength: 1 }, TRACK_WIDTH)
    const ticks = generateTicks(window, stretched, TRACK_WIDTH)
    expect(ticks.some((t) => t.label === 'present')).toBe(true)
    assertNoOverlapWithAlignment(ticks, TRACK_WIDTH)
  })
})

/** A stricter re-check than `assertNoOverlapSimple`: it accounts for `tickLabelAlign` the same
 *  way the implementation itself now does, so it actually catches the present-edge defect
 *  (`assertNoOverlapSimple`'s naive centred-width assumption cannot see it). */
function assertNoOverlapWithAlignment(ticks: ReturnType<typeof generateTicks>, trackWidthPx: number): void {
  const sorted = [...ticks].sort((a, b) => a.u - b.u)
  for (let i = 1; i < sorted.length; i++) {
    const prevRight = labelBoundsPx(sorted[i - 1]!, trackWidthPx)[1]
    const curLeft = labelBoundsPx(sorted[i]!, trackWidthPx)[0]
    expect(curLeft).toBeGreaterThanOrEqual(prevRight - 1)
  }
}

function labelBoundsPx(tick: { u: number; label: string }, trackWidthPx: number): [number, number] {
  const px = tick.u * trackWidthPx
  const width = estimateWidthPx(tick.label)
  const align = tickLabelAlign(tick.u, tick.label, trackWidthPx)
  if (align === 'start') return [px, px + width]
  if (align === 'end') return [px - width, px]
  return [px - width / 2, px + width / 2]
}

function estimateWidthPx(label: string): number {
  return label.length * 6.5 + 4
}

describe('tickLabelAlign', () => {
  it('hugs the left edge for a tick whose centred label would overhang u=0', () => {
    expect(tickLabelAlign(0, '4.57 Ga', TRACK_WIDTH)).toBe('start')
  })

  it('hugs the right edge for the "present" tick at u=1', () => {
    expect(tickLabelAlign(1, 'present', TRACK_WIDTH)).toBe('end')
  })

  it('centres a tick comfortably inside the track', () => {
    expect(tickLabelAlign(0.5, '66 Ma', TRACK_WIDTH)).toBe('center')
  })

  it('degrades to center for a non-positive track width', () => {
    expect(tickLabelAlign(1, 'present', 0)).toBe('center')
  })
})

function assertNoOverlapSimple(ticks: ReturnType<typeof generateTicks>, trackWidthPx: number): void {
  const sorted = [...ticks].sort((a, b) => a.u - b.u)
  for (let i = 1; i < sorted.length; i++) {
    const prevPx = sorted[i - 1]!.u * trackWidthPx
    const curPx = sorted[i]!.u * trackWidthPx
    const prevHalf = (sorted[i - 1]!.label.length * 6.5) / 2
    const curHalf = (sorted[i]!.label.length * 6.5) / 2
    // A slightly looser bound than the implementation's own MIN_LABEL_GAP_PX margin, since
    // this is an independent re-check with its own (slightly different) width estimate — the
    // point is to catch gross overlap, not to re-derive the exact same constant.
    expect(curPx - curHalf).toBeGreaterThanOrEqual(prevPx + prevHalf - 1)
  }
}
