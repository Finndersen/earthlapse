/**
 * Layer factories (DESIGN §10). Each wraps a `LayerManifest` entry and its already-parsed,
 * immutable curated data (from `@/data/curated`) in a `Layer` whose `sample()` closes over
 * that data and nothing else — no refs, no component state, no fetch. Constructing a layer
 * is the only place the manifest and the parsed data meet; from there on `sample()` is a
 * pure function of `t`.
 */

import { sampleEvents, sampleSeries, sampleTree } from '@/data/curated'
import type { EventsData, SeriesData, TreeData } from '@/data/curated'
import type { EventsValue, GeoTime, Layer, NodeValue, ScalarValue } from '@/types/layer'
import type { LayerManifest } from '@/types/manifest'

import { indexPortraits, portraitAt, type PortraitIndex } from './portraits'

function withinTimeDomain(timeDomain: readonly [GeoTime, GeoTime], t: GeoTime): boolean {
  const [newest, oldest] = timeDomain
  return t >= newest && t <= oldest
}

/**
 * Wraps a curated `SeriesData` (a scalar or proxy time series — CO₂, temperature, day
 * length, ...) as a `Layer<ScalarValue>`. `sample(t)` is `null` outside `entry.timeDomain`
 * *or* the data's own sample range, whichever is narrower — a layer never extrapolates or
 * substitutes a plausible value for missing coverage.
 */
export function createScalarLayer(entry: LayerManifest, data: SeriesData): Layer<ScalarValue> {
  return {
    id: entry.id,
    name: entry.name,
    timeDomain: entry.timeDomain,
    surface: entry.surface,
    source: entry.source,
    chartable: entry.chartable,
    sample(t: GeoTime): ScalarValue | null {
      if (!withinTimeDomain(entry.timeDomain, t)) return null
      return sampleSeries(data, t)
    },
  }
}

/**
 * Wraps a curated `TreeData` (a lineage, e.g. "your direct ancestor") as a `Layer<NodeValue>`.
 * `sample(t)` is the ancestor alive at `t` — the youngest node whose divergence has already
 * happened by `t` (see `sampleTree`) — or `null` outside `entry.timeDomain` or before the
 * root has diverged. When the tree publishes portraits (ADR-015), the value also carries the
 * portrait target at `t` (`portraitAt`); the index is built once, not per sample.
 *
 * `portraits` defaults to `indexPortraits(data)` so every direct caller (tests build a `Layer`
 * straight from fixture `TreeData` this way) keeps working unchanged, but a caller that also
 * needs the index itself for something else — `buildLayers.ts`'s `nodePortraits`, built for
 * `AncestorPortrait`'s neighbour preload, which needs the plates just outside `t` that
 * `sample(t)` alone can't supply — can build it once and pass it in here too, rather than this
 * function silently indexing the same `TreeData` a second time.
 */
export function createNodeLayer(entry: LayerManifest, data: TreeData, portraits: PortraitIndex | null = indexPortraits(data)): Layer<NodeValue> {
  return {
    id: entry.id,
    name: entry.name,
    timeDomain: entry.timeDomain,
    surface: entry.surface,
    source: entry.source,
    chartable: entry.chartable,
    sample(t: GeoTime): NodeValue | null {
      if (!withinTimeDomain(entry.timeDomain, t)) return null
      const node = sampleTree(data, t)
      if (node === null || portraits === null) return node
      const portrait = portraitAt(portraits, t)
      return portrait === null ? node : { ...node, portrait }
    },
  }
}

/**
 * Wraps a curated non-timeline `EventsData` (docs/GLOBE.md §6, e.g. `globe-regimes`) as a
 * `Layer<EventsValue>`. `sample(t)` is every event active at `t` (see `sampleEvents`) — an
 * empty list is a legitimate value (nothing active right now), not "no data"; only outside
 * `entry.timeDomain` does this return `null`.
 */
export function createEventsLayer(entry: LayerManifest, data: EventsData): Layer<EventsValue> {
  return {
    id: entry.id,
    name: entry.name,
    timeDomain: entry.timeDomain,
    surface: entry.surface,
    source: entry.source,
    chartable: entry.chartable,
    sample(t: GeoTime): EventsValue | null {
      if (!withinTimeDomain(entry.timeDomain, t)) return null
      return sampleEvents(data, t)
    },
  }
}
