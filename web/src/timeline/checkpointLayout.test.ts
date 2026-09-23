import { describe, expect, it } from 'vitest'

import { EARTH_FORMATION } from '@/types/layer'

import { layoutCheckpointPips, MIN_PIP_SEPARATION_PX, type CheckpointLayoutEntry } from './checkpointLayout'
import type { TimelineCheckpoint } from './checkpoints'
import { fisheyeScale, type FisheyeLens } from './fisheye'
import { createLinearScale, createSymlogScale, type TimeWindow } from './scale'

const FULL_DOMAIN: TimeWindow = [0, EARTH_FORMATION]
const FULL_DOMAIN_SCALE = createSymlogScale(FULL_DOMAIN)

function checkpoint(id: string, t: number): TimelineCheckpoint {
  return { id, t, label: id }
}

/** Every checkpoint id accounted for, as a pip or a cluster member. */
function allIds(entries: readonly CheckpointLayoutEntry[]): string[] {
  return entries.flatMap((e) => (e.kind === 'pip' ? [e.id] : e.members.map((m) => m.id)))
}

/** No two rendered markers closer than MIN_PIP_SEPARATION_PX. */
function assertNoEntryCollision(entries: readonly CheckpointLayoutEntry[], trackWidthPx: number): void {
  const pxs = [...entries].map((e) => e.u * trackWidthPx).sort((a, b) => a - b)
  for (let i = 1; i < pxs.length; i++) {
    expect(pxs[i]! - pxs[i - 1]!).toBeGreaterThanOrEqual(MIN_PIP_SEPARATION_PX)
  }
}

describe('layoutCheckpointPips', () => {
  it('lays out every in-window checkpoint as its own pip when separated, excluding the rest', () => {
    const checkpoints = [checkpoint('a', 3e8), checkpoint('b', 1e6), checkpoint('c', 1e4)]
    const entries = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)
    expect(allIds(entries).sort()).toEqual(['a', 'b', 'c'])
    expect(entries.every((e) => e.kind === 'pip')).toBe(true)
    expect(allIds(layoutCheckpointPips([checkpoint('in', 5000), checkpoint('out', 5e8)], [0, 1e4], FULL_DOMAIN_SCALE, 800))).toEqual(['in'])
    expect(layoutCheckpointPips([], FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)).toEqual([])
  })

  it('merges close checkpoints into one cluster, ordered and keyed oldest first, bounded by its members', () => {
    const checkpoints = [checkpoint('a', 1e5), checkpoint('b', 1e5 + 5), checkpoint('c', 1e5 + 10)]
    const entries = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)
    expect(entries).toHaveLength(1)
    const cluster = entries[0]
    if (!cluster || cluster.kind !== 'cluster') throw new Error('unreachable')
    expect(cluster.members.map((m) => m.id)).toEqual(['c', 'b', 'a'])
    expect(cluster.id).toBe('c')
    expect([cluster.tMin, cluster.tMax]).toEqual([1e5, 1e5 + 10])
  })

  it("clusters transitively: a merges with b and b with c even where a and c alone wouldn't", () => {
    const trackWidthPx = 800
    const scale = FULL_DOMAIN_SCALE
    const uStep = (MIN_PIP_SEPARATION_PX * 0.9) / trackWidthPx
    const centreT = 1e8
    const centreU = scale.toUnit(centreT)
    const a = scale.fromUnit(centreU + uStep)
    const b = scale.fromUnit(centreU)
    const c = scale.fromUnit(centreU - uStep)
    const checkpoints = [checkpoint('a', a), checkpoint('b', b), checkpoint('c', c)]
    const entries = layoutCheckpointPips(checkpoints, FULL_DOMAIN, scale, trackWidthPx)
    expect(entries).toHaveLength(1)
    expect(entries[0]!.kind).toBe('cluster')
  })

  it('never lets two entries render closer than MIN_PIP_SEPARATION_PX apart', () => {
    const checkpoints = Array.from({ length: 6 }, (_, i) => checkpoint(`c${i}`, 1e5 + i * 5))
    const entries = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)
    assertNoEntryCollision(entries, 800)
  })

  describe('under a real fisheye lens', () => {
    const LENS_TRACK_PX = 1440
    const LENS_WINDOW: TimeWindow = [0, 1000]
    const LENS_BASE_SCALE = createLinearScale(LENS_WINDOW)
    // u=0.5 -> px 720, u=0.503 -> px 724.32: 4.32px apart, under the 8px threshold at rest.
    const near = checkpoint('near', 500)
    const nearer = checkpoint('nearer', 497)

    it('resolves a resting cluster into pips under a lens focused over it', () => {
      expect(layoutCheckpointPips([near, nearer], LENS_WINDOW, LENS_BASE_SCALE, LENS_TRACK_PX)[0]!.kind).toBe('cluster')
      const lens: FisheyeLens = { centreU: 0.5, strength: 1 }
      const scale = fisheyeScale(LENS_BASE_SCALE, lens, LENS_TRACK_PX)
      const entries = layoutCheckpointPips([near, nearer], LENS_WINDOW, scale, LENS_TRACK_PX)
      expect(entries).toHaveLength(2)
      expect(entries.every((e) => e.kind === 'pip')).toBe(true)
      expect(allIds(entries).sort()).toEqual(['near', 'nearer'])
    })

    it('re-clusters once the lens moves away again', () => {
      const farLens: FisheyeLens = { centreU: 0.02, strength: 1 }
      const scale = fisheyeScale(LENS_BASE_SCALE, farLens, LENS_TRACK_PX)
      const entries = layoutCheckpointPips([near, nearer], LENS_WINDOW, scale, LENS_TRACK_PX)
      expect(entries).toHaveLength(1)
      expect(entries[0]!.kind).toBe('cluster')
    })
  })
})
