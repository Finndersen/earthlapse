/**
 * Layer factories (DESIGN §10). Each wraps a `LayerManifest` entry and its already-parsed,
 * immutable curated data (from `@/data/curated`) in a `Layer` whose `sample()` closes over
 * that data and nothing else — no refs, no component state, no fetch. Constructing a layer
 * is the only place the manifest and the parsed data meet; from there on `sample()` is a
 * pure function of `t`.
 */

import { sampleSeries, sampleTree } from '@/data/curated'
import type { SeriesData, TreeData } from '@/data/curated'
import type { GeoTime, Layer, NodeValue, ScalarValue } from '@/types/layer'
import type { LayerManifest } from '@/types/manifest'

import { indexPortraits, portraitAt } from './portraits'

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
 * portrait target at `t` (`portraitAt`); the index is built once, here, not per sample.
 */
export function createNodeLayer(entry: LayerManifest, data: TreeData): Layer<NodeValue> {
  const portraits = indexPortraits(data)
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
