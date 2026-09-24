import { describe, expect, it } from 'vitest'

import type { TerritoryData, TerritoryGeometry, TerritorySnapshotData } from '@/data/curated'

import {
  buildEmpireIndex,
  declutterLabelBoxes,
  empireAtLonLat,
  empireLabelsAt,
  empiresHaveDataAt,
  empireSnapshotsAt,
  lineageAreaAt,
  memberAt,
  orientedRingPixels,
  ringStrokeRuns,
  ringToPixels,
  territoryContains,
} from './empires'

function snapshot(id: string, lineage: string, member: number, tStart: number, tEnd: number, areaKm2 = 1000): TerritorySnapshotData {
  return { id, lineage, member, label: id, tStart, tEnd, lat: 0, lon: 0, areaKm2 }
}

function members(...labels: string[]) {
  return labels.map((label) => ({ label, wikipedia: label }))
}

const DATA: TerritoryData = {
  id: 'empires',
  geometry: 'vectors/cliopatria_territories-0123456789.json',
  lineages: [
    { id: 'rome', name: 'Rome', colourSlot: 3, description: '', events: [], members: members('Republic', 'Empire', 'West') },
    { id: 'china', name: 'China', colourSlot: 0, description: '', events: [], members: members('Han') },
  ],
  snapshots: [
    snapshot('republic', 'rome', 0, 2500, 2050, 500_000),
    snapshot('empire', 'rome', 1, 2050, 1600, 5_000_000),
    snapshot('west', 'rome', 2, 1630, 1550, 2_000_000),
    snapshot('han', 'china', 0, 2200, 1800, 6_000_000),
  ],
}

describe('empireSnapshotsAt', () => {
  const index = buildEmpireIndex(DATA)
  const ids = (t: number): string[] => empireSnapshotsAt(index, t).snapshots.map((s) => s.id)

  it('shows a snapshot for tEnd < t <= tStart, so abutting snapshots hand over without overlap or gap', () => {
    expect(ids(2050.5)).toEqual(['han', 'republic'])
    expect(ids(2050)).toEqual(['han', 'empire'])
    expect(ids(2500)).toEqual(['republic'])
    expect(ids(2500.5)).toEqual([])
    expect(ids(1550)).toEqual([])
    expect(ids(1551)).toEqual(['west'])
    expect(ids(1620)).toEqual(['empire', 'west'])
  })

  it('keys each distinct active set, stably across a segment', () => {
    expect(empireSnapshotsAt(index, 1700).key).toBe(empireSnapshotsAt(index, 1750).key)
    expect(empireSnapshotsAt(index, 1700).key).not.toBe(empireSnapshotsAt(index, 1620).key)
    expect(empireSnapshotsAt(index, 3000).key).toBe('')
  })

  it('reports data only inside the layer domain', () => {
    expect(empiresHaveDataAt(index, 2500)).toBe(true)
    expect(empiresHaveDataAt(index, 1551)).toBe(true)
    expect(empiresHaveDataAt(index, 1550)).toBe(false)
    expect(empiresHaveDataAt(index, 2501)).toBe(false)
    expect(empiresHaveDataAt(null, 2000)).toBe(false)
  })
})

describe('lineage summaries', () => {
  const rome = buildEmpireIndex(DATA).lineages.get('rome')!

  it('lists each member once with its own span, sums active member areas per step and finds the peak and the member at t', () => {
    expect(rome.members.map((m) => [m.label, m.tStart, m.tEnd])).toEqual([
      ['Republic', 2500, 2050],
      ['Empire', 2050, 1600],
      ['West', 1630, 1550],
    ])
    expect(rome.span).toEqual([1550, 2500])
    expect(rome.area.map((step) => [step.tStart, step.tEnd, step.areaKm2])).toEqual([
      [2500, 2050, 500_000],
      [2050, 1630, 5_000_000],
      [1630, 1600, 7_000_000],
      [1600, 1550, 2_000_000],
    ])
    expect(rome.peak.tStart).toBe(1630)
    expect(lineageAreaAt(rome, 1620)).toBe(7_000_000)
    expect(lineageAreaAt(rome, 1550)).toBe(0)
    expect(memberAt(rome, 1620)?.label).toBe('West')
    expect(memberAt(rome, 2050)?.label).toBe('Empire')
    expect(memberAt(rome, 3000)).toBeNull()
  })
})

describe('territory hit test', () => {
  // A 20°x20° square with a 4°x4° hole, and a small square inside it.
  const outer = [0, 0, 20, 0, 20, 20, 0, 20]
  const hole = [8, 8, 12, 8, 12, 12, 8, 12]
  const inner = [2, 2, 6, 2, 6, 6, 2, 6]
  const geometry: TerritoryGeometry = {
    snapshots: new Map([
      ['empire', [[outer, hole]]],
      ['west', [[inner]]],
      ['han', [[[100, 30, 110, 30, 110, 40]]]],
    ]),
  }
  const frame = empireSnapshotsAt(buildEmpireIndex(DATA), 1620)

  it('resolves the smallest active territory containing the point, outside holes, whichever way the rings wind', () => {
    expect(territoryContains([[outer, hole]], 4, 15)).toBe(true)
    expect(territoryContains([[outer, hole]], 10, 10)).toBe(false)
    expect(territoryContains([[outer, hole]], 25, 10)).toBe(false)
    expect(territoryContains([[[0, 20, 20, 20, 20, 0, 0, 0]]], 4, 15)).toBe(true)
    expect(empireAtLonLat(frame, geometry, 4, 4)?.id).toBe('west')
    expect(empireAtLonLat(frame, geometry, 15, 4)?.id).toBe('empire')
    expect(empireAtLonLat(frame, geometry, 10, 10)).toBeNull()
    // Han is not active at 1620.
    expect(empireAtLonLat(frame, geometry, 105, 32)).toBeNull()
  })
})

describe('empireLabelsAt', () => {
  it('labels each lineage once at its largest member, largest lineage first, capped', () => {
    const frame = empireSnapshotsAt(buildEmpireIndex(DATA), 1620)
    expect(empireLabelsAt(frame, 5).map((l) => [l.lineage, l.text, l.colourSlot])).toEqual([['rome', 'empire', 3]])

    const both = empireSnapshotsAt(buildEmpireIndex(DATA), 1900)
    expect(empireLabelsAt(both, 5).map((l) => l.text)).toEqual(['han', 'empire'])
    expect(empireLabelsAt(both, 1).map((l) => l.text)).toEqual(['han'])
  })
})

describe('declutterLabelBoxes', () => {
  it('drops a label only when its box overlaps one already kept, keeping earlier labels first', () => {
    const box = { halfWidth: 5, halfHeight: 1 }
    const labels: [string, [number, number, number]][] = [
      ['first', [0, 0, 1]],
      ['beside', [8, 0, 1]], // overlaps horizontally
      ['below', [0, 2.5, 1]], // clear vertically
      ['far', [11, 0, 1]], // clear horizontally
    ]
    const kept = declutterLabelBoxes(labels, ([, position]) => position, () => box)
    expect(kept.map(([name]) => name)).toEqual(['first', 'below', 'far'])
  })
})

describe('territory rings on the equirect canvas', () => {
  it('maps lon/lat to pixels with row 0 at the north pole', () => {
    expect(ringToPixels([-180, 90, 0, 0, 180, -90], 360, 180)).toEqual([0, 0, 180, 90, 360, 180])
  })

  it('winds exteriors and holes oppositely whatever the source winding', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10]
    const reversed = [0, 10, 10, 10, 10, 0, 0, 0]
    const area = (xy: number[]): number => {
      let sum = 0
      for (let i = 0; i < xy.length; i += 2) {
        const j = (i + 2) % xy.length
        sum += xy[i]! * xy[j + 1]! - xy[j]! * xy[i + 1]!
      }
      return sum
    }
    for (const ring of [square, reversed]) {
      expect(area(orientedRingPixels(ring, 360, 180, true))).toBeGreaterThan(0)
      expect(area(orientedRingPixels(ring, 360, 180, false))).toBeLessThan(0)
    }
  })

  it('never strokes the edge along the antimeridian cut', () => {
    const ring = [170, 0, 180, 0, 180, 10, 170, 10]
    const { runs, closed } = ringStrokeRuns(ring, 360, 180)
    expect(closed).toBe(false)
    // One open run from (180,10) round to (180,0): every edge but the one on lon 180.
    expect(runs).toEqual([[360, 80, 350, 80, 350, 90, 360, 90]])

    const inland = ringStrokeRuns([10, 0, 20, 0, 20, 10], 360, 180)
    expect(inland).toEqual({ runs: [[190, 90, 200, 90, 200, 80]], closed: true })
  })
})
