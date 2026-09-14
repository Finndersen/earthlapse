/**
 * Small, self-contained fixture data for this package's tests — not read from
 * `sources/*\/fixture/` (those are the offline pipeline's raw-format fixtures; this package
 * only ever sees already-parsed `SeriesData`/`TreeData`, per DATA_SOURCES § Contract and
 * ADR-002). Values are plausible but not sourced from a citation — good enough to exercise
 * sampling and rendering logic, not to publish.
 */

import type { EventsData, SeriesData, TreeData } from '@/data/curated'
import { EARTH_FORMATION, type GeoTime } from '@/types/layer'
import type { LayerManifest } from '@/types/manifest'

/** Recursively freezes an object graph so a test can assert a factory never mutates the
 *  curated data it closes over. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function') && !Object.isFrozen(value)) {
    Object.getOwnPropertyNames(value).forEach((key) => {
      deepFreeze((value as unknown as Record<string, unknown>)[key])
    })
    Object.freeze(value)
  }
  return value
}

function baseManifestEntry(overrides: Partial<LayerManifest>): LayerManifest {
  return {
    id: 'fixture',
    name: 'Fixture layer',
    surface: 'hud',
    dataKind: 'scalar',
    timeDomain: [0, EARTH_FORMATION],
    source: 'fixture-source',
    chartable: true,
    data: 'layers/fixture.json',
    ...overrides,
  }
}

/** Mirrors `sources/co2-o2` (Phanerozoic-only CO₂, GEOCARB III) in shape: present-day value
 *  is pre-industrial (~277 ppm), coverage ends at the Phanerozoic boundary (5.7e8 yr BP). */
export const CO2_MANIFEST: LayerManifest = baseManifestEntry({
  id: 'co2',
  name: 'Atmospheric CO2',
  unit: 'ppm',
  interpolation: 'log-linear',
})

export const CO2_DATA: SeriesData = {
  id: 'co2',
  unit: 'ppm',
  interpolation: 'log-linear',
  samples: [
    { t: 0, value: 276.6, lower: null, upper: null },
    { t: 1e7, value: 290, lower: null, upper: null },
    { t: 1e8, value: 1200, lower: 900, upper: 1600 },
    { t: 3e8, value: 300, lower: 200, upper: 450 },
    { t: 5.7e8, value: 4500, lower: 3000, upper: 6000 },
  ],
}

/** A day-length series in hours, for `DayLengthClock`. */
export const DAY_LENGTH_MANIFEST: LayerManifest = baseManifestEntry({
  id: 'day-length',
  name: 'Day length',
  unit: 'h',
  interpolation: 'linear',
})

export const DAY_LENGTH_DATA: SeriesData = {
  id: 'day-length',
  unit: 'h',
  interpolation: 'linear',
  samples: [
    { t: 0, value: 24, lower: null, upper: null },
    { t: 1.4e9, value: 21.9, lower: null, upper: null },
    { t: 4.5e9, value: 6, lower: null, upper: null },
  ],
}

/** A small lineage from LUCA to *H. sapiens*, sorted ascending by `tDivergence` as
 *  `parseTreeData` guarantees for real published data (DATA_SOURCES § Contract). */
export const ANCESTOR_MANIFEST: LayerManifest = baseManifestEntry({
  id: 'ancestor',
  name: 'Your direct ancestor',
  dataKind: 'node',
})

export const ANCESTOR_DATA: TreeData = {
  id: 'ancestor',
  nodes: [
    { id: 'human', parent: 'primate', label: 'Homo sapiens', tDivergence: 3e5, representative: 'Homo sapiens', note: null, citation: null },
    { id: 'primate', parent: 'mammal', label: 'First primate', tDivergence: 6.6e7, representative: 'Purgatorius', note: null, citation: null },
    { id: 'mammal', parent: 'tetrapod', label: 'First mammal', tDivergence: 2.1e8, representative: 'Morganucodon', note: null, citation: null },
    { id: 'tetrapod', parent: 'vertebrate', label: 'First tetrapod', tDivergence: 3.75e8, representative: 'Tiktaalik', note: null, citation: null },
    { id: 'vertebrate', parent: 'animal', label: 'First vertebrate', tDivergence: 5.2e8, representative: 'Pikaia', note: null, citation: null },
    { id: 'animal', parent: 'eukaryote', label: 'First animal', tDivergence: 6e8, representative: null, note: null, citation: null },
    { id: 'eukaryote', parent: 'luca', label: 'First eukaryote', tDivergence: 2.1e9, representative: null, note: null, citation: null },
    { id: 'luca', parent: null, label: 'LUCA', tDivergence: 4.2e9, representative: 'Last universal common ancestor', note: null, citation: null },
  ],
}

/** Mirrors `sources/globe-regimes` (docs/GLOBE.md §6) in shape: a non-timeline `EventSet`,
 *  two regimes with a gap between them, one carrying a `GlobeEffect`. */
export const GLOBE_REGIMES_MANIFEST: LayerManifest = baseManifestEntry({
  id: 'globe-regimes',
  name: 'Globe regimes',
  surface: 'globe',
  dataKind: 'events',
  chartable: false,
})

export const GLOBE_REGIMES_DATA: EventsData = {
  id: 'globe-regimes',
  events: [
    {
      id: 'magma-ocean-regime',
      label: 'Magma ocean and newborn Moon',
      tMin: 4.35e9,
      tMax: 4.52e9,
      importance: 0.9,
      description: 'A glowing, cracked crust; no oceans yet.',
      citation: 'Barboni et al. 2017',
      effect: { kind: 'regime-magma-ocean', windows: [{ tMin: 4.35e9, tMax: 4.52e9 }] },
    },
    {
      id: 'proterozoic-unknown-geography-regime',
      label: 'Proterozoic, geography unknown',
      tMin: 1.0e9,
      tMax: 2.4e9,
      importance: 0.3,
      description: 'No plate reconstruction reaches this far back.',
      citation: 'Merdith et al. 2021',
    },
  ],
}

export function logSpace(start: GeoTime, end: GeoTime, count: number): GeoTime[] {
  const logStart = Math.log10(start)
  const logEnd = Math.log10(end)
  return Array.from({ length: count }, (_, i) => 10 ** (logStart + (i * (logEnd - logStart)) / (count - 1)))
}
