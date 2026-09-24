/**
 * Wraps a manifest's declared layers, plus their already-loaded curated data, in `@/layers`'
 * `Layer` objects (DESIGN §10) for the shell to render. Pure and framework-free so it is easy
 * to unit test independently of the loading effect that produces its inputs.
 *
 * Raster and (non-timeline) events layers are the exception: the globe (DESIGN §7) is
 * independent of the `Layer` abstraction and needs full, raw curated data rather than a
 * `sample(t)` slice — `paleodem`/`plates_neoproterozoic` because there's no `createRasterLayer`
 * to call, `globe-regimes` because its regime crossfade (`web/src/globe/effects/regimes.ts`)
 * needs to see a regime's neighbour before `t` enters it, which `Layer<EventsValue>.sample(t)`
 * can't supply. Both are handed through next to their manifest entry, keyed by id (ADR-013:
 * "buildLayers.ts... must select raster layers by id once there are several", now true with
 * `paleodem` and `plates_neoproterozoic` both on the globe surface).
 *
 * `nodePortraits` is the same exception for a node layer's `PortraitIndex` (ADR-015): the
 * ancestor portrait's neighbour preload (`layers/portraits.ts`'s `portraitNeighbourUrls`) needs
 * to see the plates just outside whatever `t` is showing, which `Layer<NodeValue>.sample(t)`
 * likewise can't supply. Indexed once here and passed into `createNodeLayer` too, so its own
 * `sample()` closure and this map share the same `PortraitIndex` rather than each building an
 * independent one from the same `TreeData`. Omitted entirely for a lineage with no portraits,
 * same as `indexPortraits` itself.
 */

import type { EventsData, FeatureSetData, RasterData, SeriesData, TerritoryData, TreeData } from '@/data/curated'
import { createNodeLayer, createScalarLayer, indexPortraits, type PortraitIndex } from '@/layers'
import type { LayerData } from '@/shell'
import type { Layer, NodeValue, ScalarValue, TimelineEvent } from '@/types/layer'
import type { LayerManifest, Manifest } from '@/types/manifest'

export interface RasterLayerEntry {
  entry: LayerManifest
  data: RasterData
}

export interface EventsLayerEntry {
  entry: LayerManifest
  data: EventsData
}

export interface FeatureLayerEntry {
  entry: LayerManifest
  data: FeatureSetData
}

export interface TerritoryLayerEntry {
  entry: LayerManifest
  data: TerritoryData
}

export interface AppLayers {
  scalarLayers: ReadonlyMap<string, Layer<ScalarValue>>
  nodeLayers: ReadonlyMap<string, Layer<NodeValue>>
  /** Non-timeline event layers (docs/GLOBE.md §6), keyed by id — e.g. `globe-regimes`. Never
   *  `events-core`, which is inlined in `Manifest.events` and reaches the timeline that way
   *  instead. Raw, full event lists (see this module's doc comment), not `Layer<EventsValue>`. */
  eventLayers: ReadonlyMap<string, EventsLayerEntry>
  /** Every globe raster layer, keyed by curated id (`paleodem`, `plates_neoproterozoic`). */
  rasters: ReadonlyMap<string, RasterLayerEntry>
  /** Every `FeatureSet` layer (ADR-035), keyed by curated id (`cities`). Raw, like `rasters`
   *  and `eventLayers`: the globe places every feature itself and samples each one's own
   *  estimates at `t`, which no `Layer<V>.sample(t)` slice could supply. */
  featureSets: ReadonlyMap<string, FeatureLayerEntry>
  /** Every `territories` layer (ADR-059), keyed by id (`empires`). Raw, like `featureSets`: the
   *  globe rasterises the active snapshots itself and fetches their geometry file lazily. */
  territories: ReadonlyMap<string, TerritoryLayerEntry>
  /** Each node layer's full `PortraitIndex`, keyed by the same id as `nodeLayers` — omitted for
   *  a lineage that publishes no portraits (see this module's doc comment). */
  nodePortraits: ReadonlyMap<string, PortraitIndex>
}

const EMPTY_LAYERS: AppLayers = {
  scalarLayers: new Map(),
  nodeLayers: new Map(),
  eventLayers: new Map(),
  rasters: new Map(),
  featureSets: new Map(),
  territories: new Map(),
  nodePortraits: new Map(),
}

/**
 * Builds every layer declared in `manifest.layers` from its already-fetched-and-parsed data
 * in `layerData` (keyed by layer id, as `loadLayerData` produces — see `useAppData`).
 *
 * `manifest`/`layerData` are nullable so this can be called unconditionally from a component
 * that hasn't finished loading yet (`null` in, the empty `AppLayers` out) without the caller
 * needing a separate conditional hook call.
 */
export function buildLayers(manifest: Manifest | null, layerData: ReadonlyMap<string, LayerData> | null): AppLayers {
  if (manifest === null || layerData === null) return EMPTY_LAYERS

  const scalarLayers = new Map<string, Layer<ScalarValue>>()
  const nodeLayers = new Map<string, Layer<NodeValue>>()
  const eventLayers = new Map<string, EventsLayerEntry>()
  const rasters = new Map<string, RasterLayerEntry>()
  const featureSets = new Map<string, FeatureLayerEntry>()
  const territories = new Map<string, TerritoryLayerEntry>()
  const nodePortraits = new Map<string, PortraitIndex>()

  for (const entry of manifest.layers) {
    const parsed = layerData.get(entry.id)
    if (parsed === undefined) continue

    switch (entry.dataKind) {
      case 'scalar':
        // loadLayerData dispatched this entry's fetch by entry.dataKind, so `parsed` is
        // already guaranteed to be a SeriesData — the cast just bridges @/shell's untagged
        // `LayerData` union back to the shape its own dispatch already picked.
        scalarLayers.set(entry.id, createScalarLayer(entry, parsed as SeriesData))
        break
      case 'node': {
        const treeData = parsed as TreeData
        const portraits = indexPortraits(treeData)
        nodeLayers.set(entry.id, createNodeLayer(entry, treeData, portraits))
        if (portraits !== null) nodePortraits.set(entry.id, portraits)
        break
      }
      case 'raster':
        rasters.set(entry.id, { entry, data: parsed as RasterData })
        break
      case 'events':
        eventLayers.set(entry.id, { entry, data: parsed as EventsData })
        break
      case 'features':
        featureSets.set(entry.id, { entry, data: parsed as FeatureSetData })
        break
      case 'territories':
        territories.set(entry.id, { entry, data: parsed as TerritoryData })
        break
    }
  }

  return { scalarLayers, nodeLayers, eventLayers, rasters, featureSets, territories, nodePortraits }
}

/** Every `TimelineEvent` a raw `eventLayers` entry carries, or `[]` when the layer isn't
 *  published — the shape `web/src/globe/effects` wants for `globe-regimes` (its doc comment:
 *  "the full, unfiltered event list", not a `sample(t)` slice). */
export function rawEvents(eventLayers: AppLayers['eventLayers'], id: string): readonly TimelineEvent[] {
  return eventLayers.get(id)?.data.events ?? []
}
