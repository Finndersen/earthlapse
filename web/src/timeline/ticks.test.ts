import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { createLinearScale, createSymlogScale, type TimeWindow } from './scale'
import { generateTicks } from './ticks'

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
