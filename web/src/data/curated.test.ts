/**
 * Ports every scalar/raster/tree sampling case in tests/test_contracts.py, plus bounds
 * interpolation, step/nearest and parse-error cases that have no Python equivalent (bounds
 * is a TS-only extension of ScalarValue; the others exercise parsing, which Python does at
 * construction via pydantic rather than from JSON).
 */

import { describe, expect, it } from 'vitest'

import {
  parseRasterData,
  parseSeriesData,
  parseTreeData,
  pathToRoot,
  type RasterData,
  sampleRaster,
  sampleSeries,
  sampleTree,
  type SeriesData,
  type TreeData,
} from './curated'

const co2: SeriesData = {
  id: 'co2',
  unit: 'ppm',
  interpolation: 'log-linear',
  samples: [
    { t: 0, value: 420, lower: null, upper: null },
    { t: 1e8, value: 1000, lower: null, upper: null },
    { t: 5e8, value: 4000, lower: null, upper: null },
  ],
}

// Built via parseTreeData, not a literal, so the fixture is sorted ascending by
// tDivergence exactly as pydantic's model_validator sorts the Python fixture on
// construction — sampleTree/pathToRoot assume that invariant, they don't re-sort.
const lineage: TreeData = parseTreeData({
  id: 'lineage',
  nodes: [
    { id: 'luca', parent: null, label: 'LUCA', tDivergence: 4.0e9 },
    { id: 'tetrapod', parent: 'luca', label: 'Tetrapoda', tDivergence: 3.9e8 },
    { id: 'human', parent: 'tetrapod', label: 'Homo sapiens', tDivergence: 3.0e5 },
  ],
})

// --------------------------------------------------------------------------- TimeSeries

describe('sampleSeries', () => {
  it('returns an exact sample verbatim', () => {
    expect(sampleSeries(co2, 0)?.value).toBe(420)
  })

  it('keeps log-linear interpolation between neighbours', () => {
    const v = sampleSeries(co2, 5e7)!.value
    expect(v).toBeGreaterThan(420)
    expect(v).toBeLessThan(1000)
  })

  it('returns null outside the domain, never extrapolated', () => {
    expect(sampleSeries(co2, 1e10)).toBeNull()
  })

  it('returns null below the domain', () => {
    expect(sampleSeries(co2, -1)).toBeNull()
  })
})

describe('parseSeriesData', () => {
  it('sorts samples ascending on construction', () => {
    const parsed = parseSeriesData({
      id: 'x',
      unit: 'u',
      interpolation: 'linear',
      samples: [
        { t: 100, value: 2, lower: null, upper: null },
        { t: 0, value: 1, lower: null, upper: null },
      ],
    })
    expect(parsed.samples.map((s) => s.t)).toEqual([0, 100])
  })

  it('rejects an empty series', () => {
    expect(() => parseSeriesData({ id: 'x', unit: 'u', interpolation: 'linear', samples: [] })).toThrow(/empty/)
  })

  it('rejects a non-object payload', () => {
    expect(() => parseSeriesData(null)).toThrow()
    expect(() => parseSeriesData('nope')).toThrow()
  })

  it('rejects a missing required field with a descriptive error', () => {
    expect(() => parseSeriesData({ unit: 'u', interpolation: 'linear', samples: [] })).toThrow(/id/)
  })

  it('rejects an unknown interpolation', () => {
    expect(() =>
      parseSeriesData({
        id: 'x',
        unit: 'u',
        interpolation: 'quadratic',
        samples: [{ t: 0, value: 1, lower: null, upper: null }],
      }),
    ).toThrow(/interpolation/)
  })

  it('rejects a malformed sample', () => {
    expect(() =>
      parseSeriesData({
        id: 'x',
        unit: 'u',
        interpolation: 'linear',
        samples: [{ t: 0, value: 'not a number', lower: null, upper: null }],
      }),
    ).toThrow(/value/)
  })
})

// ----------------------------------------------------------------- bounds interpolation

describe('sampleSeries bounds', () => {
  const withBounds: SeriesData = {
    id: 'temp',
    unit: 'C',
    interpolation: 'linear',
    samples: [
      { t: 0, value: 10, lower: 8, upper: 12 },
      { t: 100, value: 20, lower: 16, upper: 24 },
    ],
  }

  it('carries the exact sample bounds verbatim', () => {
    expect(sampleSeries(withBounds, 0)?.bounds).toEqual([8, 12])
  })

  it('interpolates bounds the same way as value when both neighbours have them', () => {
    const v = sampleSeries(withBounds, 50)!
    expect(v.value).toBeCloseTo(15)
    expect(v.bounds).toEqual([12, 18])
  })

  it('omits bounds when only one neighbour has them', () => {
    const oneSided: SeriesData = {
      id: 'temp',
      unit: 'C',
      interpolation: 'linear',
      samples: [
        { t: 0, value: 10, lower: 8, upper: 12 },
        { t: 100, value: 20, lower: null, upper: null },
      ],
    }
    expect(sampleSeries(oneSided, 50)!.bounds).toBeUndefined()
  })

  it('omits bounds when neither neighbour has them', () => {
    expect(sampleSeries(co2, 5e7)!.bounds).toBeUndefined()
  })
})

// -------------------------------------------------------------- step / nearest / linear

describe('sampleSeries interpolation kinds', () => {
  const step: SeriesData = {
    id: 's',
    unit: 'u',
    interpolation: 'step',
    samples: [
      { t: 0, value: 1, lower: null, upper: null },
      { t: 100, value: 2, lower: null, upper: null },
    ],
  }

  it('step holds the newer-side sample for any f in (0, 1)', () => {
    expect(sampleSeries(step, 1)?.value).toBe(1)
    expect(sampleSeries(step, 50)?.value).toBe(1)
    expect(sampleSeries(step, 99)?.value).toBe(1)
  })

  it('step returns the exact sample verbatim on the newer boundary', () => {
    expect(sampleSeries(step, 0)?.value).toBe(1)
  })

  const nearest: SeriesData = {
    id: 'n',
    unit: 'u',
    interpolation: 'nearest',
    samples: [
      { t: 0, value: 1, lower: null, upper: null },
      { t: 100, value: 2, lower: null, upper: null },
    ],
  }

  it('nearest takes the newer sample when f < 0.5', () => {
    expect(sampleSeries(nearest, 40)?.value).toBe(1)
  })

  it('nearest takes the older sample when f >= 0.5', () => {
    expect(sampleSeries(nearest, 50)?.value).toBe(2)
    expect(sampleSeries(nearest, 60)?.value).toBe(2)
  })

  const linear: SeriesData = {
    id: 'l',
    unit: 'u',
    interpolation: 'linear',
    samples: [
      { t: 0, value: 0, lower: null, upper: null },
      { t: 100, value: 100, lower: null, upper: null },
    ],
  }

  it('linear blends proportionally', () => {
    expect(sampleSeries(linear, 25)?.value).toBeCloseTo(25)
  })

  it('log-linear degrades to linear when a value is non-positive', () => {
    const degrading: SeriesData = {
      id: 'd',
      unit: 'u',
      interpolation: 'log-linear',
      samples: [
        { t: 0, value: -10, lower: null, upper: null },
        { t: 100, value: 10, lower: null, upper: null },
      ],
    }
    expect(sampleSeries(degrading, 50)?.value).toBeCloseTo(0)
  })
})

// ----------------------------------------------------------------------- RasterSequence

const frames: RasterData = {
  id: 'r',
  frames: [
    { t: 0, ref: 'a.png' },
    { t: 100, ref: 'b.png' },
  ],
}

describe('sampleRaster', () => {
  it('blends alpha continuously between frames', () => {
    const blend = sampleRaster(frames, 25)
    expect(blend).not.toBeNull()
    expect(blend!.before).toBe('a.png')
    expect(blend!.after).toBe('b.png')
    expect(blend!.alpha).toBeCloseTo(0.25)
  })

  it('collapses before/after with alpha 0 on an exact match', () => {
    const blend = sampleRaster(frames, 100)
    expect(blend).toEqual({ kind: 'raster', before: 'b.png', after: 'b.png', alpha: 0 })
  })

  it('returns null outside the domain', () => {
    expect(sampleRaster(frames, 1000)).toBeNull()
  })
})

describe('parseRasterData', () => {
  it('sorts frames ascending on construction', () => {
    const parsed = parseRasterData({
      id: 'r',
      frames: [
        { t: 100, ref: 'b.png' },
        { t: 0, ref: 'a.png' },
      ],
    })
    expect(parsed.frames.map((f) => f.t)).toEqual([0, 100])
  })

  it('rejects an empty raster sequence', () => {
    expect(() => parseRasterData({ id: 'r', frames: [] })).toThrow(/empty/)
  })

  it('rejects a malformed frame', () => {
    expect(() => parseRasterData({ id: 'r', frames: [{ t: 0 }] })).toThrow(/ref/)
  })
})

// --------------------------------------------------------------------------------- Tree

describe('sampleTree', () => {
  it('returns the lineage member alive at t', () => {
    expect(sampleTree(lineage, 1e9)?.label).toBe('LUCA')
    expect(sampleTree(lineage, 2e8)?.label).toBe('Tetrapoda')
  })

  it('returns null before the root', () => {
    expect(sampleTree(lineage, 5e9)).toBeNull()
  })
})

describe('pathToRoot', () => {
  it('walks back to the root, root first', () => {
    expect(pathToRoot(lineage, 'human').map((n) => n.id)).toEqual(['luca', 'tetrapod', 'human'])
  })

  it('returns an empty path for an unknown node', () => {
    expect(pathToRoot(lineage, 'ghost')).toEqual([])
  })
})

describe('parseTreeData', () => {
  it('sorts nodes ascending by tDivergence on construction', () => {
    const parsed = parseTreeData({
      id: 't',
      nodes: [
        { id: 'b', parent: 'a', label: 'B', tDivergence: 100, representative: null, note: null, citation: null },
        { id: 'a', parent: null, label: 'A', tDivergence: 1, representative: null, note: null, citation: null },
      ],
    })
    expect(parsed.nodes.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('rejects an unknown parent', () => {
    expect(() =>
      parseTreeData({
        id: 't',
        nodes: [{ id: 'a', parent: 'ghost', label: 'A', tDivergence: 1, representative: null, note: null, citation: null }],
      }),
    ).toThrow(/unknown parent/)
  })

  it('rejects an empty tree', () => {
    expect(() => parseTreeData({ id: 't', nodes: [] })).toThrow(/empty/)
  })
})
