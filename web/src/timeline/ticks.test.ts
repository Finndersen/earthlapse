import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { fisheyeScale } from './fisheye'
import { createLinearScale, createSymlogScale, type TimeWindow } from './scale'
import { generateTicks, tickLabelAlign } from './ticks'

const TRACK_WIDTH = 900

const CASES: { name: string; window: TimeWindow; kind: 'symlog' | 'linear' }[] = [
  { name: '1-year span, linear', window: [0, 1], kind: 'linear' },
  { name: 'the Holocene, symlog', window: [0, 1.17e4], kind: 'symlog' },
  { name: 'a mid-domain window, symlog', window: [2e8, 2.1e8], kind: 'symlog' },
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

  it('includes "present" only when the window touches t=0, sorted left to right', () => {
    const touching = generateTicks([0, 1e8], createSymlogScale([0, 1e8]), TRACK_WIDTH)
    expect(touching.some((t) => t.label === 'present')).toBe(true)
    for (let i = 1; i < touching.length; i++) expect(touching[i]!.u).toBeGreaterThanOrEqual(touching[i - 1]!.u)
    expect(generateTicks([1e6, 1e8], createSymlogScale([1e6, 1e8]), TRACK_WIDTH).some((t) => t.label === 'present')).toBe(false)
  })

  it('labels a Holocene window in round calendar years, linear or log', () => {
    const window: TimeWindow = [0, 1.17e4]
    for (const scale of [createLinearScale(window), createSymlogScale(window)]) {
      const years = generateTicks(window, scale, TRACK_WIDTH)
        .filter((tick) => tick.t !== 0)
        .map((tick) => 2025 - tick.t)
      expect(years.length).toBeGreaterThan(1)
      for (const year of years) expect(Math.abs(year % 10)).toBe(0)
    }
  })

  it('thins rather than overlaps on a narrow track, and yields nothing at zero width', () => {
    const window: TimeWindow = [0, EARTH_FORMATION]
    assertNoOverlapSimple(generateTicks(window, createSymlogScale(window), 120), 120)
    expect(generateTicks(window, createSymlogScale(window), 0)).toEqual([])
  })

  it('never overlaps the edge-anchored "present" label with its neighbour, even fisheye-stretched near it', () => {
    const window: TimeWindow = [0, EARTH_FORMATION]
    const base = createSymlogScale(window)
    const stretched = fisheyeScale(base, { centreU: 1, strength: 1 }, TRACK_WIDTH)
    const ticks = generateTicks(window, stretched, TRACK_WIDTH)
    expect(ticks.some((t) => t.label === 'present')).toBe(true)
    assertNoOverlapWithAlignment(ticks, TRACK_WIDTH)
  })
})

/** Overlap check honouring `tickLabelAlign`, needed for the edge-anchored "present" label. */
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
  it('anchors labels that would overhang an edge, centring the rest', () => {
    expect(tickLabelAlign(0, '4.57 Ga', TRACK_WIDTH)).toBe('start')
    expect(tickLabelAlign(1, 'present', TRACK_WIDTH)).toBe('end')
    expect(tickLabelAlign(0.5, '66 Ma', TRACK_WIDTH)).toBe('center')
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
    expect(curPx - curHalf).toBeGreaterThanOrEqual(prevPx + prevHalf - 1)
  }
}
