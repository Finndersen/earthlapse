/**
 * Wraps a manifest's declared layers, plus their already-loaded curated data, in `@/layers`'
 * `Layer` objects (DESIGN §10) for the shell to render. Pure and framework-free so it is easy
 * to unit test independently of the loading effect that produces its inputs.
 *
 * Raster layers (`paleodem`) are the one exception: the globe (DESIGN §7) is independent of
 * the `Layer` abstraction and consumes `RasterData` directly, so there is no
 * `createRasterLayer` in `@/layers` to call here — this just hands the parsed data through
 * next to its manifest entry.
 */

import type { RasterData, SeriesData, TreeData } from '@/data/curated'
import { createNodeLayer, createScalarLayer } from '@/layers'
import type { LayerData } from '@/shell'
import type { Layer, NodeValue, ScalarValue } from '@/types/layer'
import type { LayerManifest, Manifest } from '@/types/manifest'

export interface RasterLayerEntry {
  entry: LayerManifest
  data: RasterData
}

export interface AppLayers {
  scalarLayers: ReadonlyMap<string, Layer<ScalarValue>>
  nodeLayers: ReadonlyMap<string, Layer<NodeValue>>
  /** The manifest's one raster layer (globe paleogeography), if it declares one. */
  raster: RasterLayerEntry | null
}

const EMPTY_LAYERS: AppLayers = { scalarLayers: new Map(), nodeLayers: new Map(), raster: null }

/**
 * Builds every layer declared in `manifest.layers` from its already-fetched-and-parsed data
 * in `layerData` (keyed by layer id, as `loadLayerData` produces — see `useAppData`). An entry
 * with no matching `layerData` (only possible for `dataKind: 'events'`, which has no per-layer
 * data file — see `loadLayerData`'s own doc comment) is skipped rather than treated as an
 * error, since `Manifest.events` is its real home.
 *
 * `manifest`/`layerData` are nullable so this can be called unconditionally from a component
 * that hasn't finished loading yet (`null` in, the empty `AppLayers` out) without the caller
 * needing a separate conditional hook call.
 */
export function buildLayers(manifest: Manifest | null, layerData: ReadonlyMap<string, LayerData> | null): AppLayers {
  if (manifest === null || layerData === null) return EMPTY_LAYERS

  const scalarLayers = new Map<string, Layer<ScalarValue>>()
  const nodeLayers = new Map<string, Layer<NodeValue>>()
  let raster: RasterLayerEntry | null = null

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
      case 'node':
        nodeLayers.set(entry.id, createNodeLayer(entry, parsed as TreeData))
        break
      case 'raster':
        raster = { entry, data: parsed as RasterData }
        break
      case 'events':
        break
    }
  }

  return { scalarLayers, nodeLayers, raster }
}
