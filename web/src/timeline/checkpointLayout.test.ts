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

/** Every checkpoint id the layout actually accounts for, whether as a lone pip or as a cluster
 *  member — the "never drop a checkpoint" guarantee, restated for the clustering API. */
function allIds(entries: readonly CheckpointLayoutEntry[]): string[] {
  return entries.flatMap((e) => (e.kind === 'pip' ? [e.id] : e.members.map((m) => m.id)))
}

/** Asserts no two entries (pips or clusters) render closer than `MIN_PIP_SEPARATION_PX` — the
 *  guarantee clustering itself exists to enforce (a merged group renders as one marker instead
 *  of colliding sub-markers). */
function assertNoEntryCollision(entries: readonly CheckpointLayoutEntry[], trackWidthPx: number): void {
  const pxs = [...entries].map((e) => e.u * trackWidthPx).sort((a, b) => a - b)
  for (let i = 1; i < pxs.length; i++) {
    expect(pxs[i]! - pxs[i - 1]!).toBeGreaterThanOrEqual(MIN_PIP_SEPARATION_PX)
  }
}

describe('layoutCheckpointPips', () => {
  it('never drops a checkpoint inside the window', () => {
    const checkpoints = [checkpoint('a', 3e8), checkpoint('b', 1e6), checkpoint('c', 1e4)]
    const entries = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)
    expect(allIds(entries).sort()).toEqual(['a', 'b', 'c'])
  })

  it('excludes checkpoints outside the window', () => {
    const checkpoints = [checkpoint('inside', 5000), checkpoint('outside', 5e8)]
    const entries = layoutCheckpointPips(checkpoints, [0, 1e4], FULL_DOMAIN_SCALE, 800)
    expect(allIds(entries)).toEqual(['inside'])
  })

  it('renders every checkpoint as its own pip when they are all comfortably separated', () => {
    const checkpoints = [checkpoint('a', 3e8), checkpoint('b', 1e6), checkpoint('c', 1e4)]
    const entries = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)
    expect(entries.every((e) => e.kind === 'pip')).toBe(true)
  })

  it('merges checkpoints closer than MIN_PIP_SEPARATION_PX into one cluster', () => {
    const checkpoints = [checkpoint('a', 1e5), checkpoint('b', 1e5 + 5), checkpoint('c', 1e5 + 10)]
    const entries = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)
    expect(entries).toHaveLength(1)
    const cluster = entries[0]
    if (!cluster || cluster.kind !== 'cluster') throw new Error('unreachable')
    // Screen order is oldest-to-newest (left to right); 'c' has the largest t (oldest) and
    // sorts first.
    expect(cluster.members.map((m) => m.id)).toEqual(['c', 'b', 'a'])
  })

  it("clusters transitively: a merges with b and b with c even where a and c alone wouldn't", () => {
    // a-b and b-c are each under the threshold; a-c is not — single-link clustering still
    // groups all three via the chain through b, the same way a person visually grouping dots
    // on a line would.
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

  it("keys a cluster by its first member's id, in screen order", () => {
    const checkpoints = [checkpoint('older', 1e5 + 10), checkpoint('newer', 1e5)]
    const entries = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)
    expect(entries).toHaveLength(1)
    const cluster = entries[0]
    if (!cluster || cluster.kind !== 'cluster') throw new Error('unreachable')
    // Screen order is oldest-to-newest (left to right); the larger t sorts first.
    expect(cluster.members[0]!.id).toBe('older')
    expect(cluster.id).toBe('older')
  })

  it("bounds a cluster's tMin/tMax to its members' own extremes", () => {
    const checkpoints = [checkpoint('a', 1e5), checkpoint('b', 1e5 + 5), checkpoint('c', 1e5 + 10)]
    const entries = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)
    const cluster = entries[0]
    if (!cluster || cluster.kind !== 'cluster') throw new Error('unreachable')
    expect(cluster.tMin).toBe(1e5)
    expect(cluster.tMax).toBe(1e5 + 10)
  })

  it('never lets two entries render closer than MIN_PIP_SEPARATION_PX apart', () => {
    const checkpoints = Array.from({ length: 6 }, (_, i) => checkpoint(`c${i}`, 1e5 + i * 5))
    const entries = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)
    assertNoEntryCollision(entries, 800)
  })

  it('keeps pleistocene-steppe, neolithic-river-settlement and modern-city all accounted for at full zoom-out on a narrow track', () => {
    // Regression (ported from the pre-ADR-019 row-stagger test): at full zoom-out on symlog
    // these three sit close to the right (present) edge and collide on an ~160px track.
    const trackWidthPx = 160
    const checkpoints = [
      checkpoint('pleistocene-steppe', 20000),
      checkpoint('neolithic-river-settlement', 9000),
      checkpoint('modern-city', 0),
    ]
    const entries = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, trackWidthPx)
    expect(allIds(entries).sort()).toEqual(['modern-city', 'neolithic-river-settlement', 'pleistocene-steppe'])
    assertNoEntryCollision(entries, trackWidthPx)
  })

  it('re-resolves a cluster back into individual pips once a stretched scale gives its members room (fisheye reveal)', () => {
    // A narrow track clusters these two at rest...
    const trackWidthPx = 100
    const checkpoints = [checkpoint('a', 1e5), checkpoint('b', 1e5 + 50)]
    const rest = layoutCheckpointPips(checkpoints, FULL_DOMAIN, FULL_DOMAIN_SCALE, trackWidthPx)
    expect(rest).toHaveLength(1)
    expect(rest[0]!.kind).toBe('cluster')

    // ...but a scale that reports both checkpoints much further apart in displayed space (what
    // the fisheye lens does to whatever it's centred over) resolves them back into separate pips.
    const stretched: typeof FULL_DOMAIN_SCALE = {
      ...FULL_DOMAIN_SCALE,
      toUnit: (t) => (t === 1e5 ? 0.2 : t === 1e5 + 50 ? 0.8 : FULL_DOMAIN_SCALE.toUnit(t)),
    }
    const revealed = layoutCheckpointPips(checkpoints, FULL_DOMAIN, stretched, trackWidthPx)
    expect(revealed).toHaveLength(2)
    expect(revealed.every((e) => e.kind === 'pip')).toBe(true)
  })

  it('degrades to an empty layout for an empty checkpoint list', () => {
    expect(layoutCheckpointPips([], FULL_DOMAIN, FULL_DOMAIN_SCALE, 800)).toEqual([])
  })

  describe('under a real fisheye lens (ADR-017/ADR-019)', () => {
    // A 1440px track, matching fisheye.ts's own "typical" width and the design brief's worked
    // example ("a lens over the cluster on a 1440px track") — exercised against the actual
    // `fisheyeScale`, not a hand-rolled stand-in for what the lens does.
    const LENS_TRACK_PX = 1440
    const LENS_WINDOW: TimeWindow = [0, 1000]
    const LENS_BASE_SCALE = createLinearScale(LENS_WINDOW)
    // u=0.5 -> px 720, u=0.503 -> px 724.32: 4.32px apart, under the 8px threshold at rest.
    const near = checkpoint('near', 500)
    const nearer = checkpoint('nearer', 497)

    it('clusters at rest (no lens)', () => {
      const entries = layoutCheckpointPips([near, nearer], LENS_WINDOW, LENS_BASE_SCALE, LENS_TRACK_PX)
      expect(entries).toHaveLength(1)
      expect(entries[0]!.kind).toBe('cluster')
    })

    it('resolves into individual pips once a lens focused over it stretches them apart', () => {
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
