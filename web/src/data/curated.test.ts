import { describe, expect, it } from 'vitest'

import {
  type EventsData,
  parseEventsData,
  parseFeatureSetData,
  parseRasterData,
  parseSeriesData,
  parseTerritoryData,
  parseTerritoryGeometry,
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

type Sample = { t: number; value: number; lower?: number | null; upper?: number | null }

function series(interpolation: SeriesData['interpolation'], samples: Sample[], extra: object = {}): SeriesData {
  return {
    id: 's',
    unit: 'u',
    interpolation,
    samples: samples.map((s) => ({ lower: null, upper: null, ...s })),
    ...extra,
  } as SeriesData
}

const co2 = series('log-linear', [
  { t: 0, value: 420 },
  { t: 1e8, value: 1000 },
  { t: 5e8, value: 4000 },
])

// Parsed rather than literal: sampleTree/pathToRoot rely on the parser's ascending sort.
const lineage: TreeData = parseTreeData({
  id: 'lineage',
  nodes: [
    { id: 'luca', parent: null, label: 'LUCA', tDivergence: 4.0e9 },
    { id: 'tetrapod', parent: 'luca', label: 'Tetrapoda', tDivergence: 3.9e8 },
    { id: 'human', parent: 'tetrapod', label: 'Homo sapiens', tDivergence: 3.0e5 },
  ],
})

describe('sampleSeries', () => {
  it('returns an exact sample verbatim', () => {
    expect(sampleSeries(co2, 0)?.value).toBe(420)
  })

  it('interpolates log-linearly between neighbours', () => {
    const v = sampleSeries(co2, 5e7)!.value
    expect(v).toBeGreaterThan(420)
    expect(v).toBeLessThan(1000)
  })

  it('returns null outside the domain on either side', () => {
    expect(sampleSeries(co2, 1e10)).toBeNull()
    expect(sampleSeries(co2, -1)).toBeNull()
  })

  it('interpolates each kind as declared', () => {
    const two = (kind: SeriesData['interpolation'], a: number, b: number) =>
      series(kind, [
        { t: 0, value: a },
        { t: 100, value: b },
      ])
    expect(sampleSeries(two('linear', 0, 100), 25)?.value).toBeCloseTo(25)
    expect(sampleSeries(two('step', 1, 2), 99)?.value).toBe(1)
    expect(sampleSeries(two('nearest', 1, 2), 40)?.value).toBe(1)
    expect(sampleSeries(two('nearest', 1, 2), 50)?.value).toBe(2)
    expect(sampleSeries(two('log-linear', -10, 10), 50)?.value).toBeCloseTo(0)
  })

  it('interpolates bounds only when both neighbours carry them', () => {
    const withBounds = series('linear', [
      { t: 0, value: 10, lower: 8, upper: 12 },
      { t: 100, value: 20, lower: 16, upper: 24 },
    ])
    expect(sampleSeries(withBounds, 0)?.bounds).toEqual([8, 12])
    expect(sampleSeries(withBounds, 50)?.bounds).toEqual([12, 18])
    const oneSided = series('linear', [
      { t: 0, value: 10, lower: 8, upper: 12 },
      { t: 100, value: 20 },
    ])
    expect(sampleSeries(oneSided, 50)!.bounds).toBeUndefined()
  })

  describe('with a gap', () => {
    const withGap = series(
      'linear',
      [0, 1, 2, 3].map((t) => ({ t, value: t + 1 })),
      { gaps: [{ fromIndex: 1, toIndex: 2 }] },
    )

    it('returns null strictly inside the gap and exact samples at its edges', () => {
      expect(sampleSeries(withGap, 1.5)).toBeNull()
      expect(sampleSeries(withGap, 1)?.value).toBe(2)
      expect(sampleSeries(withGap, 2)?.value).toBe(3)
      expect(sampleSeries(withGap, 0.5)?.value).toBeCloseTo(1.5)
    })

    it('is pure in t across repeated calls', () => {
      expect(sampleSeries(withGap, 1.5)).toEqual(sampleSeries(withGap, 1.5))
      expect(sampleSeries(withGap, 0.5)).toEqual(sampleSeries(withGap, 0.5))
    })
  })
})

describe('parseSeriesData', () => {
  const FOUR = [0, 1, 2, 3].map((t) => ({ t, value: t, lower: null, upper: null }))
  const payload = (extra: object = {}) => ({ id: 'x', unit: 'u', interpolation: 'linear', samples: FOUR, ...extra })

  it('sorts samples and gaps ascending', () => {
    const parsed = parseSeriesData(
      payload({
        samples: [FOUR[3], FOUR[0]],
        gaps: [{ fromIndex: 0, toIndex: 1 }],
      }),
    )
    expect(parsed.samples.map((s) => s.t)).toEqual([0, 3])
    const gaps = parseSeriesData(
      payload({
        gaps: [
          { fromIndex: 1, toIndex: 2 },
          { fromIndex: 0, toIndex: 1 },
        ],
      }),
    ).gaps
    expect(gaps).toEqual([
      { fromIndex: 0, toIndex: 1 },
      { fromIndex: 1, toIndex: 2 },
    ])
    expect(parseSeriesData(payload()).gaps).toBeUndefined()
  })

  it.each([
    ['a non-object payload', null, /./],
    ['a missing id', { unit: 'u', interpolation: 'linear', samples: FOUR }, /id/],
    ['an empty series', payload({ samples: [] }), /empty/],
    ['an unknown interpolation', payload({ interpolation: 'quadratic' }), /interpolation/],
    ['a malformed sample', payload({ samples: [{ t: 0, value: 'x', lower: null, upper: null }] }), /value/],
    ['a non-adjacent gap', payload({ gaps: [{ fromIndex: 0, toIndex: 2 }] }), /not adjacent/],
    ['an out-of-range gap', payload({ gaps: [{ fromIndex: 3, toIndex: 4 }] }), /out of range/],
    [
      'overlapping gaps',
      payload({
        gaps: [
          { fromIndex: 0, toIndex: 1 },
          { fromIndex: 0, toIndex: 1 },
        ],
      }),
      /overlap/,
    ],
  ])('rejects %s', (_label, input, error) => {
    expect(() => parseSeriesData(input)).toThrow(error)
  })
})

const frames: RasterData = {
  id: 'r',
  frames: [
    { t: 0, ref: 'a.png' },
    { t: 100, ref: 'b.png' },
  ],
}

describe('sampleRaster', () => {
  it('blends alpha continuously between frames', () => {
    expect(sampleRaster(frames, 25)).toMatchObject({ before: 'a.png', after: 'b.png' })
    expect(sampleRaster(frames, 25)!.alpha).toBeCloseTo(0.25)
  })

  it('collapses to one frame with alpha 0 on an exact match', () => {
    expect(sampleRaster(frames, 100)).toEqual({ kind: 'raster', before: 'b.png', after: 'b.png', alpha: 0 })
  })

  it('returns null outside the domain', () => {
    expect(sampleRaster(frames, 1000)).toBeNull()
  })
})

describe('parseRasterData', () => {
  const one = [{ t: 0, ref: 'a.png' }]

  it('sorts frames ascending and carries an optional encoding through', () => {
    const parsed = parseRasterData({ id: 'r', frames: [{ t: 100, ref: 'b.png' }, ...one] })
    expect(parsed.frames.map((f) => f.t)).toEqual([0, 100])
    expect(parsed.encoding).toBeUndefined()
    const encoding = { channel: 'r', unit: 'people/km2', dMax: 15000 }
    expect(parseRasterData({ id: 'r', frames: one, encoding }).encoding).toEqual(encoding)
  })

  it.each([
    ['an empty sequence', { id: 'r', frames: [] }, /empty/],
    ['a frame without ref', { id: 'r', frames: [{ t: 0 }] }, /ref/],
    ['an unknown channel', { id: 'r', frames: one, encoding: { channel: 'alpha', unit: 'u', dMax: 1 } }, /channel/],
    ['a non-positive dMax', { id: 'r', frames: one, encoding: { channel: 'r', unit: 'u', dMax: 0 } }, /dMax/],
  ])('rejects %s', (_label, input, error) => {
    expect(() => parseRasterData(input)).toThrow(error)
  })
})

describe('Tree', () => {
  it('samples the lineage member alive at t, null before the root', () => {
    expect(sampleTree(lineage, 1e9)?.label).toBe('LUCA')
    expect(sampleTree(lineage, 2e8)?.label).toBe('Tetrapoda')
    expect(sampleTree(lineage, 5e9)).toBeNull()
  })

  it('walks pathToRoot root first, empty for an unknown node', () => {
    expect(pathToRoot(lineage, 'human').map((n) => n.id)).toEqual(['luca', 'tetrapod', 'human'])
    expect(pathToRoot(lineage, 'ghost')).toEqual([])
  })

  it('parses nodes sorted by tDivergence', () => {
    const node = (id: string, parent: string | null, t: number) => ({
      id,
      parent,
      label: id,
      tDivergence: t,
      representative: null,
      note: null,
      citation: null,
    })
    expect(parseTreeData({ id: 't', nodes: [node('b', 'a', 100), node('a', null, 1)] }).nodes.map((n) => n.id)).toEqual([
      'a',
      'b',
    ])
    expect(() => parseTreeData({ id: 't', nodes: [node('a', 'ghost', 1)] })).toThrow(/unknown parent/)
    expect(() => parseTreeData({ id: 't', nodes: [] })).toThrow(/empty/)
  })
})

function event(effect?: object, extra: object = {}): Record<string, unknown> {
  return { id: 'x', label: 'X', tMin: 0, tMax: 10, importance: 0.5, description: 'd', citation: 'c', effect, ...extra }
}

function arrival(overrides: object = {}): object {
  return {
    kind: 'arrival',
    arrivalKind: 'migration',
    origin: { lat: 0, lon: 0 },
    destination: { lat: 1, lon: 1 },
    established: 5,
    windows: [{ tMin: 0, tMax: 10 }],
    ...overrides,
  }
}

describe('parseTimelineEvent', () => {
  it('leaves effect undefined when absent', () => {
    expect(parseTimelineEvent(event(), 'x').effect).toBeUndefined()
  })

  it('parses point, anchor-less and arrival effects', () => {
    const impact = {
      kind: 'impact-winter',
      anchor: { lat: 21.3, lon: -89.5 },
      windows: [{ tMin: 6.6032e7, tMax: 6.6054e7 }],
    }
    expect(parseTimelineEvent(event(impact), 'x').effect).toEqual(impact)
    const snowball = parseTimelineEvent(
      event({
        kind: 'ice-shell',
        windows: [
          { tMin: 6.61e8, tMax: 7.17e8 },
          { tMin: 6.35e8, tMax: 6.39e8 },
        ],
      }),
      'x',
    ).effect
    expect(snowball).toMatchObject({ kind: 'ice-shell' })
    expect(snowball && 'anchor' in snowball ? snowball.anchor : undefined).toBeUndefined()
    expect(parseTimelineEvent(event(arrival({ arrivalKind: 'peopling' })), 'x').effect).toEqual(
      arrival({ arrivalKind: 'peopling' }),
    )
  })

  it.each([
    ['an unknown effect kind', { kind: 'volcano', windows: [{ tMin: 0, tMax: 1 }] }, /unknown GlobeEffectKind/],
    ['an effect with no windows', { kind: 'giant-impact', windows: [] }, /empty windows/],
    ['an arrival without origin', arrival({ origin: undefined }), /origin/],
    ['an arrival never reaching the present', arrival({ windows: [{ tMin: 1, tMax: 10 }] }), /present/],
    ['an arrival established outside its windows', arrival({ established: 500 }), /established/],
    [
      'an arrival with two present-reaching windows',
      arrival({
        windows: [
          { tMin: 0, tMax: 10 },
          { tMin: 0, tMax: 20 },
        ],
      }),
      /exactly one window/,
    ],
    ['an arrival without arrivalKind', arrival({ arrivalKind: undefined }), /arrivalKind/],
    ['an arrival with an unknown arrivalKind', arrival({ arrivalKind: 'colonisation' }), /arrivalKind/],
  ])('rejects %s', (_label, effect, error) => {
    expect(() => parseTimelineEvent(event(effect), 'x')).toThrow(error)
  })
})

const regimesData: EventsData = parseEventsData({
  id: 'globe-regimes',
  events: [
    event(
      { kind: 'regime-magma-ocean', windows: [{ tMin: 4.35e9, tMax: 4.52e9 }] },
      { id: 'magma', tMin: 4.35e9, tMax: 4.52e9 },
    ),
    event(undefined, { id: 'proterozoic', tMin: 1.0e9, tMax: 2.4e9 }),
  ],
})

describe('EventsData', () => {
  it('parses events with their effects and rejects an empty set', () => {
    expect(regimesData.events.map((e) => e.id)).toEqual(['magma', 'proterozoic'])
    expect(regimesData.events[0]?.effect?.kind).toBe('regime-magma-ocean')
    expect(() => parseEventsData({ id: 'e', events: [] })).toThrow(/empty/)
  })

  it('samples every event containing t, and an empty list (never null) elsewhere', () => {
    expect(sampleEvents(regimesData, 4.4e9).events.map((e) => e.id)).toEqual(['magma'])
    expect(sampleEvents(regimesData, 3e9)).toEqual({ kind: 'events', events: [] })
    expect(sampleEvents(regimesData, 0).events).toEqual([])
  })
})

function city(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
  it('sorts features by id and estimates by t', () => {
    const data = parseFeatureSetData({ id: 'cities', features: [city({ id: 'zanzibar' }), city()] })
    expect(data.features.map((f) => f.id)).toEqual(['uruk-iraq', 'zanzibar'])
    expect(data.features[0]?.estimates.map((e) => e.t)).toEqual([5700, 6700])
  })

  it.each([
    ['an empty set', [], /empty/],
    ['a duplicate feature id', [city(), city()], /duplicate feature id/],
    ['a feature with no estimates', [city({ estimates: [] })], /empty estimates/],
    [
      'a duplicate estimate t',
      [
        city({
          estimates: [
            { t: 100, population: 1 },
            { t: 100, population: 2 },
          ],
        }),
      ],
      /duplicate estimate t/,
    ],
    ['an out-of-range latitude', [city({ lat: 91 })], /lat/],
    ['an out-of-range longitude', [city({ lon: 181 })], /lon/],
    ['an unknown certainty', [city({ certainty: 'very sure' })], /FeatureCertainty/],
    ['a non-positive population', [city({ estimates: [{ t: 0, population: 0 }] })], /./],
  ])('rejects %s', (_label, features, error) => {
    expect(() => parseFeatureSetData({ id: 'cities', features })).toThrow(error)
  })
})

describe('parseTerritoryData', () => {
  const lineage = { id: 'rome', name: 'Rome', colourSlot: 3 }
  const territory = (overrides: object = {}): object => ({
    id: 'roman-empire-117ce',
    lineage: 'rome',
    label: 'Roman Empire',
    tStart: 1908,
    tEnd: 1893,
    lat: 41.2,
    lon: 14.1,
    areaKm2: 5_261_057,
    ...overrides,
  })
  const layer = (snapshots: object[], lineages: object[] = [lineage]): object => ({
    id: 'empires',
    geometry: 'vectors/cliopatria_territories-0123456789.json',
    lineages,
    snapshots,
  })

  it('sorts snapshots oldest first and checks the geometry file covers every one', () => {
    const data = parseTerritoryData(layer([territory({ id: 'b', tStart: 1000, tEnd: 900 }), territory({ id: 'a' })]))
    expect(data.snapshots.map((s) => s.id)).toEqual(['a', 'b'])
    const ring = [10, 40, 20, 40, 20, 45]
    expect(parseTerritoryGeometry({ precision: 0.01, snapshots: { a: [[ring]], b: [[ring]] } }, data).snapshots.get('a')).toEqual([[ring]])
    expect(() => parseTerritoryGeometry({ precision: 0.01, snapshots: { a: [[ring]] } }, data)).toThrow(/b: missing/)
    expect(() => parseTerritoryGeometry({ precision: 0.01, snapshots: { a: [[[10, 40, 20]]], b: [[ring]] } }, data)).toThrow(/even count/)
  })

  it.each([
    ['an empty snapshot list', layer([]), /empty/],
    ['a duplicate snapshot id', layer([territory(), territory()]), /duplicate snapshot id/],
    ['an unknown lineage', layer([territory({ lineage: 'carthage' })]), /unknown lineage/],
    ['a colour slot outside the palette', layer([territory()], [{ ...lineage, colourSlot: 8 }]), /colourSlot/],
    ['a snapshot ending before it starts', layer([territory({ tEnd: 1908 })]), /tStart/],
    ['a non-positive area', layer([territory({ areaKm2: 0 })]), /areaKm2/],
  ])('rejects %s', (_label, json, error) => {
    expect(() => parseTerritoryData(json)).toThrow(error)
  })
})
