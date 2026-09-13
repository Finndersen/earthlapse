import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { layoutCheckpointPips, MIN_PIP_SEPARATION_PX } from './checkpointLayout'
import type { TimelineCheckpoint } from './checkpoints'
import { createSymlogScale, type TimeWindow } from './scale'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]
const FULL_DOMAIN_SCALE = createSymlogScale(FULL_DOMAIN)

function checkpoint(id: string, t: number): TimelineCheckpoint {
  return { id, t, label: id }
}

/** Asserts the core guarantee: every pip in the same row is at least `MIN_PIP_SEPARATION_PX`
 *  from the next one in that row, when sorted by pixel position. */
function assertNoSameRowCollision(pips: ReturnType<typeof layoutCheckpointPips>, trackWidthPx: number): void {
  const byRow = new Map<number, number[]>()
  for (const pip of pips) {
    const px = pip.u * trackWidthPx
    const row = byRow.get(pip.row) ?? []
    row.push(px)
    byRow.set(pip.row, row)
  }
  for (const pxs of byRow.values()) {
    const sorted = [...pxs].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(MIN_PIP_SEPARATION_PX)
    }
  }
}

describe('layoutCheckpointPips', () => {
  it('never drops a checkpoint inside the window', () => {
    const checkpoints = [checkpoint('a', 3e8), checkpoint('b', 1e6), checkpoint('c', 1e4)]
    const pips = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)
    expect(pips.map((p) => p.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('excludes checkpoints outside the window', () => {
    const checkpoints = [checkpoint('inside', 5000), checkpoint('outside', 5e8)]
    const pips = layoutCheckpointPips(checkpoints, [0, 1e4], FULL_DOMAIN_SCALE, 800)
    expect(pips.map((p) => p.id)).toEqual(['inside'])
  })

  it('keeps every pip in row 0 when they are all comfortably separated', () => {
    const checkpoints = [checkpoint('a', 3e8), checkpoint('b', 1e6), checkpoint('c', 1e4)]
    const pips = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)
    expect(pips.every((p) => p.row === 0)).toBe(true)
  })

  it('never lets two same-row pips render closer than MIN_PIP_SEPARATION_PX', () => {
    // A cluster of checkpoints all within a few hundred years of each other, guaranteed to
    // collide in pixel space at any reasonable track width.
    const checkpoints = Array.from({ length: 6 }, (_, i) => checkpoint(`c${i}`, 1e5 + i * 5))
    const pips = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)
    expect(pips).toHaveLength(6)
    assertNoSameRowCollision(pips, 800)
  })

  it('keeps pleistocene-steppe, neolithic-river-settlement and modern-city all visible at full zoom-out on a narrow track', () => {
    // Regression: at full zoom-out on symlog these three sit close to the right (present)
    // edge. Verified against the scale math: t=20000 -> u≈0.9157, t=9000 -> u≈0.9507,
    // t=0 -> u=1, which collide (< MIN_PIP_SEPARATION_PX apart) on a narrow ~160px track.
    const trackWidthPx = 160
    const checkpoints = [
      checkpoint('pleistocene-steppe', 20000),
      checkpoint('neolithic-river-settlement', 9000),
      checkpoint('modern-city', 0),
    ]
    const pips = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, trackWidthPx)

    expect(pips.map((p) => p.id)).toEqual(['pleistocene-steppe', 'neolithic-river-settlement', 'modern-city'])
    // Confirm the premise: without staggering, at least one adjacent pair would collide.
    const pxs = pips.map((p) => p.u * trackWidthPx)
    expect(pxs[1]! - pxs[0]!).toBeLessThan(MIN_PIP_SEPARATION_PX)
    assertNoSameRowCollision(pips, trackWidthPx)
  })

  it('degrades to an empty layout for an empty checkpoint list', () => {
    expect(layoutCheckpointPips([], FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)).toEqual([])
  })
})
