/**
 * Ports every scalar/raster/tree sampling case in tests/test_contracts.py, plus bounds
 * interpolation, step/nearest and parse-error cases that have no Python equivalent (bounds
 * is a TS-only extension of ScalarValue; the others exercise parsing, which Python does at
 * construction via pydantic rather than from JSON).
 */

import { describe, expect, it } from 'vitest'

import {
  type EventsData,
  parseEventsData,
  parseFeatureSetData,
  parseRasterData,
  parseSeriesData,
  parseTimelineEvent,
  parseTreeData,
  pathToRoot,
  type RasterData,
  sampleEvents,
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

// ------------------------------------------------------------------------------------- Gap

const FOUR_SAMPLES = [
  { t: 0, value: 1, lower: null, upper: null },
  { t: 1, value: 2, lower: null, upper: null },
  { t: 2, value: 3, lower: null, upper: null },
  { t: 3, value: 4, lower: null, upper: null },
]

describe('parseSeriesData gaps (ADR-027)', () => {
  it('is absent when the payload has none', () => {
    expect(parseSeriesData({ id: 'x', unit: 'u', interpolation: 'linear', samples: FOUR_SAMPLES }).gaps).toBeUndefined()
  })

  it('parses and sorts ascending by fromIndex', () => {
    const parsed = parseSeriesData({
      id: 'x',
      unit: 'u',
      interpolation: 'linear',
      samples: FOUR_SAMPLES,
      gaps: [
        { fromIndex: 2, toIndex: 3 },
        { fromIndex: 0, toIndex: 1 },
      ],
    })
    expect(parsed.gaps).toEqual([
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 2, toIndex: 3 },
    ])
  })

  it('rejects a gap whose indices are not adjacent', () => {
    expect(() =>
      parseSeriesData({
        id: 'x',
        unit: 'u',
        interpolation: 'linear',
        samples: FOUR_SAMPLES,
        gaps: [{ fromIndex: 0, toIndex: 2 }],
      }),
    ).toThrow(/not adjacent/)
  })

  it('rejects a gap whose toIndex is out of range', () => {
    expect(() =>
      parseSeriesData({
        id: 'x',
        unit: 'u',
        interpolation: 'linear',
        samples: FOUR_SAMPLES,
        gaps: [{ fromIndex: 3, toIndex: 4 }],
      }),
    ).toThrow(/out of range/)
  })

  it('rejects overlapping gaps', () => {
    expect(() =>
      parseSeriesData({
        id: 'x',
        unit: 'u',
        interpolation: 'linear',
        samples: FOUR_SAMPLES,
        gaps: [
          { fromIndex: 0, toIndex: 1 },
          { fromIndex: 0, toIndex: 1 },
        ],
      }),
    ).toThrow(/overlap/)
  })

  it('accepts two gaps that share one boundary sample', () => {
    const parsed = parseSeriesData({
      id: 'x',
      unit: 'u',
      interpolation: 'linear',
      samples: FOUR_SAMPLES,
      gaps: [
        { fromIndex: 1, toIndex: 2 },
        { fromIndex: 0, toIndex: 1 },
      ],
    })
    expect(parsed.gaps).toEqual([
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
    ])
  })
})

describe('sampleSeries and gaps (ADR-027)', () => {
  const withGap: SeriesData = {
    id: 'x',
    unit: 'u',
    interpolation: 'linear',
    samples: FOUR_SAMPLES,
    gaps: [{ fromIndex: 1, toIndex: 2 }],
  }

  it('returns null strictly inside a gap', () => {
    expect(sampleSeries(withGap, 1.5)).toBeNull()
  })

  it('returns the exact sample verbatim at each of the gap\'s own edges', () => {
    expect(sampleSeries(withGap, 1)?.value).toBe(2)
    expect(sampleSeries(withGap, 2)?.value).toBe(3)
  })

  it('still interpolates outside the gap', () => {
    expect(sampleSeries(withGap, 0.5)?.value).toBeCloseTo(1.5)
  })

  it('is pure: repeated calls against the same data object give the same result', () => {
    // Exercises the per-series WeakMap cache curated.ts builds to avoid rebuilding its time
    // array on every call — same data, same t, must always agree.
    expect(sampleSeries(withGap, 1.5)).toEqual(sampleSeries(withGap, 1.5))
    expect(sampleSeries(withGap, 0.5)).toEqual(sampleSeries(withGap, 0.5))
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

describe('parseRasterData encoding (ADR-031 amendment)', () => {
  it('parses with no encoding at all — additive, colour-only rasters are unaffected', () => {
    const parsed = parseRasterData({ id: 'paleodem', frames: [{ t: 0, ref: 'a.png' }] })
    expect(parsed.encoding).toBeUndefined()
  })

  it('carries a published encoding through', () => {
    const parsed = parseRasterData({
      id: 'hyde_population_density',
      frames: [{ t: 0, ref: 'a.png' }],
      encoding: { channel: 'r', unit: 'people/km2', dMax: 15000 },
    })
    expect(parsed.encoding).toEqual({ channel: 'r', unit: 'people/km2', dMax: 15000 })
  })

  it('rejects an unknown channel', () => {
    expect(() =>
      parseRasterData({
        id: 'r',
        frames: [{ t: 0, ref: 'a.png' }],
        encoding: { channel: 'alpha', unit: 'people/km2', dMax: 15000 },
      }),
    ).toThrow(/channel/)
  })

  it('rejects a non-positive dMax', () => {
    expect(() =>
      parseRasterData({
        id: 'r',
        frames: [{ t: 0, ref: 'a.png' }],
        encoding: { channel: 'r', unit: 'people/km2', dMax: 0 },
      }),
    ).toThrow(/dMax/)
    expect(() =>
      parseRasterData({
        id: 'r',
        frames: [{ t: 0, ref: 'a.png' }],
        encoding: { channel: 'r', unit: 'people/km2', dMax: -5 },
      }),
    ).toThrow(/dMax/)
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

// --------------------------------------------------------------------------- EventSet / effects

const regimesData: EventsData = parseEventsData({
  id: 'globe-regimes',
  events: [
    {
      id: 'magma-ocean-regime',
      label: 'Magma ocean',
      tMin: 4.35e9,
      tMax: 4.52e9,
      importance: 0.9,
      description: 'd',
      citation: 'c',
      effect: {
        kind: 'regime-magma-ocean',
        windows: [{ tMin: 4.35e9, tMax: 4.52e9 }],
      },
    },
    {
      id: 'proterozoic-unknown-geography-regime',
      label: 'Proterozoic, geography unknown',
      tMin: 1.0e9,
      tMax: 2.4e9,
      importance: 0.3,
      description: 'd',
      citation: 'c',
    },
  ],
})

describe('parseTimelineEvent', () => {
  it('leaves effect undefined when the field is absent', () => {
    const event = parseTimelineEvent(
      { id: 'x', label: 'X', tMin: 0, tMax: 1, importance: 0.5, description: 'd', citation: 'c' },
      'x',
    )
    expect(event.effect).toBeUndefined()
  })

  it('parses an effect with an anchor and several windows', () => {
    const event = parseTimelineEvent(
      {
        id: 'k-pg-impact',
        label: 'K-Pg impact',
        tMin: 6.6032e7,
        tMax: 6.6054e7,
        importance: 1.0,
        description: 'd',
        citation: 'c',
        effect: {
          kind: 'impact-winter',
          anchor: { lat: 21.3, lon: -89.5 },
          windows: [{ tMin: 6.6032e7, tMax: 6.6054e7 }],
        },
      },
      'x',
    )
    expect(event.effect).toEqual({
      kind: 'impact-winter',
      anchor: { lat: 21.3, lon: -89.5 },
      windows: [{ tMin: 6.6032e7, tMax: 6.6054e7 }],
    })
  })

  it('parses an anchor-less effect with several windows', () => {
    const event = parseTimelineEvent(
      {
        id: 'snowball-earth',
        label: 'Snowball Earth',
        tMin: 6.35e8,
        tMax: 7.2e8,
        importance: 0.85,
        description: 'd',
        citation: 'c',
        effect: {
          kind: 'ice-shell',
          windows: [
            { tMin: 6.61e8, tMax: 7.17e8 },
            { tMin: 6.35e8, tMax: 6.39e8 },
          ],
        },
      },
      'x',
    )
    if (event.effect?.kind !== 'ice-shell') throw new Error('expected a point globe effect')
    expect(event.effect.anchor).toBeUndefined()
    expect(event.effect.windows).toHaveLength(2)
  })

  it('rejects an unknown effect kind', () => {
    expect(() =>
      parseTimelineEvent(
        {
          id: 'x',
          label: 'X',
          tMin: 0,
          tMax: 1,
          importance: 0.5,
          description: 'd',
          citation: 'c',
          effect: { kind: 'volcano', windows: [{ tMin: 0, tMax: 1 }] },
        },
        'x',
      ),
    ).toThrow(/unknown GlobeEffectKind/)
  })

  it('rejects an effect with no windows', () => {
    expect(() =>
      parseTimelineEvent(
        {
          id: 'x',
          label: 'X',
          tMin: 0,
          tMax: 1,
          importance: 0.5,
          description: 'd',
          citation: 'c',
          effect: { kind: 'giant-impact', windows: [] },
        },
        'x',
      ),
    ).toThrow(/empty windows/)
  })

  // ------------------------------------------------------------- arrival effect (ADR-032)

  it('parses an arrival effect with origin, destination, established and arrivalKind', () => {
    const event = parseTimelineEvent(
      {
        id: 'levant-early-dispersal',
        label: 'Levant early dispersal',
        tMin: 177000,
        tMax: 194000,
        importance: 0.5,
        description: 'd',
        citation: 'c',
        effect: {
          kind: 'arrival',
          arrivalKind: 'peopling',
          origin: { lat: 2.0, lon: 20.0 },
          destination: { lat: 31.5, lon: 35.0 },
          established: 185500,
          windows: [{ tMin: 0, tMax: 194000 }],
        },
      },
      'x',
    )
    expect(event.effect).toEqual({
      kind: 'arrival',
      arrivalKind: 'peopling',
      origin: { lat: 2.0, lon: 20.0 },
      destination: { lat: 31.5, lon: 35.0 },
      established: 185500,
      windows: [{ tMin: 0, tMax: 194000 }],
    })
  })

  it('rejects an arrival effect missing origin or destination', () => {
    expect(() =>
      parseTimelineEvent(
        {
          id: 'x',
          label: 'X',
          tMin: 0,
          tMax: 1,
          importance: 0.5,
          description: 'd',
          citation: 'c',
          effect: {
            kind: 'arrival',
            arrivalKind: 'migration',
            destination: { lat: 0, lon: 0 },
            established: 0,
            windows: [{ tMin: 0, tMax: 1 }],
          },
        },
        'x',
      ),
    ).toThrow(/origin/)
  })

  it('rejects an arrival effect whose windows never reach the present', () => {
    expect(() =>
      parseTimelineEvent(
        {
          id: 'x',
          label: 'X',
          tMin: 0,
          tMax: 10,
          importance: 0.5,
          description: 'd',
          citation: 'c',
          effect: {
            kind: 'arrival',
            arrivalKind: 'migration',
            origin: { lat: 0, lon: 0 },
            destination: { lat: 1, lon: 1 },
            established: 5,
            windows: [{ tMin: 1, tMax: 10 }],
          },
        },
        'x',
      ),
    ).toThrow(/present/)
  })

  it('rejects an arrival effect whose established date falls outside every window', () => {
    expect(() =>
      parseTimelineEvent(
        {
          id: 'x',
          label: 'X',
          tMin: 0,
          tMax: 10,
          importance: 0.5,
          description: 'd',
          citation: 'c',
          effect: {
            kind: 'arrival',
            arrivalKind: 'migration',
            origin: { lat: 0, lon: 0 },
            destination: { lat: 1, lon: 1 },
            established: 500,
            windows: [{ tMin: 0, tMax: 10 }],
          },
        },
        'x',
      ),
    ).toThrow(/established/)
  })

  it('rejects an arrival effect with more than one window reaching the present (exactly one is required)', () => {
    expect(() =>
      parseTimelineEvent(
        {
          id: 'x',
          label: 'X',
          tMin: 0,
          tMax: 10,
          importance: 0.5,
          description: 'd',
          citation: 'c',
          effect: {
            kind: 'arrival',
            arrivalKind: 'migration',
            origin: { lat: 0, lon: 0 },
            destination: { lat: 1, lon: 1 },
            established: 5,
            windows: [
              { tMin: 0, tMax: 10 },
              { tMin: 0, tMax: 20 },
            ],
          },
        },
        'x',
      ),
    ).toThrow(/exactly one window/)
  })

  // ------------------------------------------------------------- arrivalKind (ADR-032 amendment)

  it('rejects an arrival effect with a missing arrivalKind', () => {
    expect(() =>
      parseTimelineEvent(
        {
          id: 'x',
          label: 'X',
          tMin: 0,
          tMax: 1,
          importance: 0.5,
          description: 'd',
          citation: 'c',
          effect: {
            kind: 'arrival',
            origin: { lat: 0, lon: 0 },
            destination: { lat: 1, lon: 1 },
            established: 0,
            windows: [{ tMin: 0, tMax: 1 }],
          },
        },
        'x',
      ),
    ).toThrow(/arrivalKind/)
  })

  it('rejects an arrival effect with an unknown arrivalKind', () => {
    expect(() =>
      parseTimelineEvent(
        {
          id: 'x',
          label: 'X',
          tMin: 0,
          tMax: 1,
          importance: 0.5,
          description: 'd',
          citation: 'c',
          effect: {
            kind: 'arrival',
            arrivalKind: 'colonisation',
            origin: { lat: 0, lon: 0 },
            destination: { lat: 1, lon: 1 },
            established: 0,
            windows: [{ tMin: 0, tMax: 1 }],
          },
        },
        'x',
      ),
    ).toThrow(/arrivalKind/)
  })
})

describe('parseEventsData', () => {
  it('parses a non-timeline EventSet, effect included', () => {
    expect(regimesData.id).toBe('globe-regimes')
    expect(regimesData.events.map((e) => e.id)).toEqual(['magma-ocean-regime', 'proterozoic-unknown-geography-regime'])
    expect(regimesData.events[0]?.effect?.kind).toBe('regime-magma-ocean')
  })

  it('rejects an empty EventsData', () => {
    expect(() => parseEventsData({ id: 'e', events: [] })).toThrow(/empty/)
  })
})

describe('sampleEvents', () => {
  it('returns every event whose interval contains t', () => {
    expect(sampleEvents(regimesData, 4.4e9).events.map((e) => e.id)).toEqual(['magma-ocean-regime'])
  })

  it('returns an empty list — not null — in a gap between events', () => {
    // Between the magma-ocean regime (ends 4.35 Ga) and the unknown-geography regime
    // (starts 2.4 Ga): nothing is active, but the layer still has data at this t.
    expect(sampleEvents(regimesData, 3e9)).toEqual({ kind: 'events', events: [] })
  })

  it('never returns null, even outside every event — EventsData declares no domain of its own', () => {
    expect(sampleEvents(regimesData, 0).events).toEqual([])
  })
})

// ------------------------------------------------------------------------- FeatureSet (ADR-035)

function validCity(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'uruk-iraq',
    name: 'Uruk',
    country: 'Iraq',
    lat: 31.32,
    lon: 45.64,
    certainty: 'high',
    estimates: [
      { t: 6700, population: 14_000 },
      { t: 5700, population: 40_000 },
    ],
    ...overrides,
  }
}

describe('parseFeatureSetData', () => {
  it('parses a FeatureSet, sorting features by id and estimates by t', () => {
    const data = parseFeatureSetData({
      id: 'cities',
      features: [validCity({ id: 'zanzibar-tanzania', name: 'Zanzibar' }), validCity()],
    })
    expect(data.id).toBe('cities')
    expect(data.features.map((f) => f.id)).toEqual(['uruk-iraq', 'zanzibar-tanzania'])
    expect(data.features[0]?.estimates.map((e) => e.t)).toEqual([5700, 6700])
  })

  it('rejects an empty FeatureSetData', () => {
    expect(() => parseFeatureSetData({ id: 'cities', features: [] })).toThrow(/empty/)
  })

  it('rejects a duplicate feature id', () => {
    expect(() =>
      parseFeatureSetData({ id: 'cities', features: [validCity(), validCity()] }),
    ).toThrow(/duplicate feature id/)
  })

  it('rejects a feature with no estimates', () => {
    expect(() =>
      parseFeatureSetData({ id: 'cities', features: [validCity({ estimates: [] })] }),
    ).toThrow(/empty estimates/)
  })

  it('rejects a duplicate estimate t within one feature', () => {
    expect(() =>
      parseFeatureSetData({
        id: 'cities',
        features: [
          validCity({
            estimates: [
              { t: 100, population: 1 },
              { t: 100, population: 2 },
            ],
          }),
        ],
      }),
    ).toThrow(/duplicate estimate t/)
  })

  it('rejects an out-of-range latitude', () => {
    expect(() => parseFeatureSetData({ id: 'cities', features: [validCity({ lat: 91 })] })).toThrow(
      /lat/,
    )
  })

  it('rejects an out-of-range longitude', () => {
    expect(() => parseFeatureSetData({ id: 'cities', features: [validCity({ lon: 181 })] })).toThrow(
      /lon/,
    )
  })

  it('rejects an unknown certainty value', () => {
    expect(() =>
      parseFeatureSetData({ id: 'cities', features: [validCity({ certainty: 'very sure' })] }),
    ).toThrow(/FeatureCertainty/)
  })

  it('rejects a non-positive population', () => {
    expect(() =>
      parseFeatureSetData({
        id: 'cities',
        features: [validCity({ estimates: [{ t: 0, population: 0 }] })],
      }),
    ).toThrow()
  })
})
