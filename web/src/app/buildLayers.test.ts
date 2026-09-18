import { describe, expect, it } from 'vitest'

import type { EventsData, FeatureSetData, SeriesData, TreeData } from '@/data/curated'
import type { LayerData } from '@/shell'
import { EARTH_FORMATION } from '@/types/layer'
import type { LayerManifest, Manifest } from '@/types/manifest'

import { buildLayers, rawEvents } from './buildLayers'

function baseManifestEntry(overrides: Partial<LayerManifest>): LayerManifest {
  return {
    id: 'fixture',
    name: 'Fixture layer',
    surface: 'hud',
    dataKind: 'scalar',
    timeDomain: [0, EARTH_FORMATION],
    source: 'fixture-source',
    chartable: false,
    data: 'layers/fixture.json',
    ...overrides,
  }
}

const CO2_ENTRY = baseManifestEntry({ id: 'co2', dataKind: 'scalar', unit: 'ppm', interpolation: 'log-linear' })
const CO2_DATA: SeriesData = {
  id: 'co2',
  unit: 'ppm',
  interpolation: 'log-linear',
  samples: [{ t: 0, value: 280, lower: null, upper: null }],
}

const LINEAGE_ENTRY = baseManifestEntry({ id: 'lineage', dataKind: 'node' })
const LINEAGE_DATA: TreeData = {
  id: 'lineage',
  nodes: [{ id: 'luca', parent: null, label: 'LUCA', tDivergence: 4e9, representative: null, note: null, citation: null }],
}

// Same lineage id, but with a published portrait, for the `nodePortraits` coverage below.
const PORTRAIT_LINEAGE_DATA: TreeData = {
  ...LINEAGE_DATA,
  portraits: {
    plates: [
      { nodeId: 'luca', image: 'portraits/luca.png', plate: 'MICROSCOPE', pinned: '0123456789abcdef', width: 1024, height: 1024 },
    ],
    morphs: [],
  },
}

const PALEODEM_ENTRY = baseManifestEntry({ id: 'paleodem', surface: 'globe', dataKind: 'raster' })
const PALEODEM_DATA = { id: 'paleodem', frames: [{ t: 0, ref: 'a.png' }] }

// Mirrors sources/globe-regimes (docs/GLOBE.md §6): a non-timeline events layer, surfaced
// on the globe, never listed on the timeline (that's Manifest.events, which buildLayers
// never reads — the timeline gets events straight from the manifest, not through a Layer).
const GLOBE_REGIMES_ENTRY = baseManifestEntry({ id: 'globe-regimes', surface: 'globe', dataKind: 'events' })
const GLOBE_REGIMES_DATA: EventsData = {
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
      effect: { kind: 'regime-magma-ocean', windows: [{ tMin: 4.35e9, tMax: 4.52e9 }] },
    },
  ],
}

// Mirrors sources/cities (ADR-035): a FeatureSet layer, surfaced on the globe, handed through
// raw like rasters and non-timeline events — no Layer<V> could supply per-feature estimates.
const CITIES_ENTRY = baseManifestEntry({ id: 'cities', surface: 'globe', dataKind: 'features' })
const CITIES_DATA: FeatureSetData = {
  id: 'cities',
  features: [
    {
      id: 'uruk-iraq',
      name: 'Uruk',
      country: 'Iraq',
      lat: 31.32,
      lon: 45.64,
      certainty: 'high',
      estimates: [{ t: 5700, population: 40_000 }],
    },
  ],
}

function manifestWith(layers: LayerManifest[]): Manifest {
  return {
    schemaVersion: 1,
    buildId: 'test',
    assetBase: '/media',
    scenes: [],
    chapters: [],
    layers,
    events: [],
    audioStems: [],
    credits: [],
  }
}

describe('buildLayers', () => {
  it('returns the empty AppLayers when either input is null', () => {
    const empty = buildLayers(null, null)
    expect(empty.scalarLayers.size).toBe(0)
    expect(empty.nodeLayers.size).toBe(0)
    expect(empty.eventLayers.size).toBe(0)
    expect(empty.rasters.size).toBe(0)
    expect(empty.featureSets.size).toBe(0)
    expect(empty.nodePortraits.size).toBe(0)
  })

  it('wraps a scalar entry as a Layer<ScalarValue>', () => {
    const manifest = manifestWith([CO2_ENTRY])
    const layerData = new Map<string, LayerData>([['co2', CO2_DATA]])
    const { scalarLayers } = buildLayers(manifest, layerData)
    expect(scalarLayers.get('co2')?.sample(0)).toEqual({ kind: 'scalar', value: 280, unit: 'ppm' })
  })

  it('wraps a node entry as a Layer<NodeValue>', () => {
    const manifest = manifestWith([LINEAGE_ENTRY])
    const layerData = new Map<string, LayerData>([['lineage', LINEAGE_DATA]])
    const { nodeLayers } = buildLayers(manifest, layerData)
    expect(nodeLayers.get('lineage')?.sample(4e9)?.id).toBe('luca')
  })

  it('omits a node entry from nodePortraits when its lineage publishes no portraits', () => {
    const manifest = manifestWith([LINEAGE_ENTRY])
    const layerData = new Map<string, LayerData>([['lineage', LINEAGE_DATA]])
    const { nodePortraits } = buildLayers(manifest, layerData)
    expect(nodePortraits.has('lineage')).toBe(false)
  })

  it('indexes a node entry\'s published portraits into nodePortraits, keyed like nodeLayers', () => {
    const manifest = manifestWith([LINEAGE_ENTRY])
    const layerData = new Map<string, LayerData>([['lineage', PORTRAIT_LINEAGE_DATA]])
    const { nodePortraits } = buildLayers(manifest, layerData)
    expect(nodePortraits.get('lineage')?.plates).toHaveLength(1)
    expect(nodePortraits.get('lineage')?.plates[0]?.nodeId).toBe('luca')
  })

  it('hands a raster entry through as parsed data, not a Layer, keyed by id', () => {
    const manifest = manifestWith([PALEODEM_ENTRY])
    const layerData = new Map<string, LayerData>([['paleodem', PALEODEM_DATA]])
    const { rasters } = buildLayers(manifest, layerData)
    expect(rasters.get('paleodem')).toEqual({ entry: PALEODEM_ENTRY, data: PALEODEM_DATA })
  })

  it('hands a non-timeline events entry (docs/GLOBE.md §6) through as parsed data, not a Layer', () => {
    const manifest = manifestWith([GLOBE_REGIMES_ENTRY])
    const layerData = new Map<string, LayerData>([['globe-regimes', GLOBE_REGIMES_DATA]])
    const { eventLayers } = buildLayers(manifest, layerData)
    expect(eventLayers.get('globe-regimes')).toEqual({ entry: GLOBE_REGIMES_ENTRY, data: GLOBE_REGIMES_DATA })
  })

  it('hands a features entry (ADR-035) through as parsed data, not a Layer, keyed by id', () => {
    const manifest = manifestWith([CITIES_ENTRY])
    const layerData = new Map<string, LayerData>([['cities', CITIES_DATA]])
    const { featureSets } = buildLayers(manifest, layerData)
    expect(featureSets.get('cities')).toEqual({ entry: CITIES_ENTRY, data: CITIES_DATA })
  })

  it('rawEvents reads a raw eventLayers entry’s full event list, or [] when unpublished', () => {
    const manifest = manifestWith([GLOBE_REGIMES_ENTRY])
    const layerData = new Map<string, LayerData>([['globe-regimes', GLOBE_REGIMES_DATA]])
    const { eventLayers } = buildLayers(manifest, layerData)
    expect(rawEvents(eventLayers, 'globe-regimes')).toEqual(GLOBE_REGIMES_DATA.events)
    expect(rawEvents(eventLayers, 'not-published')).toEqual([])
  })

  it('skips a manifest entry with no matching layerData rather than throwing', () => {
    const manifest = manifestWith([CO2_ENTRY])
    const { scalarLayers } = buildLayers(manifest, new Map())
    expect(scalarLayers.size).toBe(0)
  })
})
