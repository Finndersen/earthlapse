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
  it('is empty when either input is null, and skips entries without data', () => {
    const empty = buildLayers(null, null)
    for (const bucket of [empty.scalarLayers, empty.nodeLayers, empty.eventLayers, empty.rasters, empty.featureSets, empty.nodePortraits]) {
      expect(bucket.size).toBe(0)
    }
    expect(buildLayers(manifestWith([CO2_ENTRY]), new Map()).scalarLayers.size).toBe(0)
  })

  it('wraps scalar and node entries as sampling Layers, indexing portraits only when published', () => {
    const plain = buildLayers(manifestWith([CO2_ENTRY, LINEAGE_ENTRY]), new Map<string, LayerData>([['co2', CO2_DATA], ['lineage', LINEAGE_DATA]]))
    expect(plain.scalarLayers.get('co2')?.sample(0)).toEqual({ kind: 'scalar', value: 280, unit: 'ppm' })
    expect(plain.nodeLayers.get('lineage')?.sample(4e9)?.id).toBe('luca')
    expect(plain.nodePortraits.has('lineage')).toBe(false)
    const withPortraits = buildLayers(manifestWith([LINEAGE_ENTRY]), new Map<string, LayerData>([['lineage', PORTRAIT_LINEAGE_DATA]]))
    expect(withPortraits.nodePortraits.get('lineage')?.plates.map((p) => p.nodeId)).toEqual(['luca'])
  })

  it('hands raster, events and features entries through raw, keyed by id', () => {
    const { rasters, eventLayers, featureSets } = buildLayers(
      manifestWith([PALEODEM_ENTRY, GLOBE_REGIMES_ENTRY, CITIES_ENTRY]),
      new Map<string, LayerData>([['paleodem', PALEODEM_DATA], ['globe-regimes', GLOBE_REGIMES_DATA], ['cities', CITIES_DATA]]),
    )
    expect(rasters.get('paleodem')).toEqual({ entry: PALEODEM_ENTRY, data: PALEODEM_DATA })
    expect(eventLayers.get('globe-regimes')).toEqual({ entry: GLOBE_REGIMES_ENTRY, data: GLOBE_REGIMES_DATA })
    expect(featureSets.get('cities')).toEqual({ entry: CITIES_ENTRY, data: CITIES_DATA })
    expect(rawEvents(eventLayers, 'globe-regimes')).toEqual(GLOBE_REGIMES_DATA.events)
    expect(rawEvents(eventLayers, 'not-published')).toEqual([])
  })
})
