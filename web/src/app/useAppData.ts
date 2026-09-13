'use client'

/**
 * Loads the manifest and every layer's data file in one batch, so the page has everything it
 * needs before it renders any real content — per the W12a brief, "loading states show nothing
 * rather than wrong values". A partial render (manifest in, layer data still in flight) would
 * otherwise have to invent a placeholder value for each not-yet-loaded layer; waiting for the
 * whole batch avoids that question entirely.
 *
 * Any failure — the manifest 404s on both the real and stub URL, a layer's data file 404s, a
 * malformed JSON payload — rejects the whole batch and surfaces as `status: 'error'`, per
 * `loadManifest`'s own "throw loudly, never render half a broken manifest" contract.
 */

import { useEffect, useState } from 'react'

import { loadLayerData, loadManifest, type LayerData } from '@/shell'
import type { Manifest } from '@/types/manifest'

export type AppDataState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; manifest: Manifest; isStub: boolean; layerData: ReadonlyMap<string, LayerData> }

/** `dataKind: 'events'` has no per-layer data file — events live inlined in `Manifest.events`
 *  (see `loadLayerData`'s doc comment) — so it is excluded from the fetch batch rather than
 *  making every caller handle its guaranteed rejection. */
function hasOwnDataFile(dataKind: Manifest['layers'][number]['dataKind']): boolean {
  return dataKind !== 'events'
}

export function useAppData(): AppDataState {
  const [state, setState] = useState<AppDataState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function run(): Promise<void> {
      const { manifest, isStub } = await loadManifest()
      const entries = manifest.layers.filter((l) => hasOwnDataFile(l.dataKind))
      const dataList = await Promise.all(entries.map((entry) => loadLayerData(manifest, entry)))
      if (cancelled) return
      const layerData = new Map(entries.map((entry, i) => [entry.id, dataList[i]!]))
      setState({ status: 'ready', manifest, isStub, layerData })
    }

    run().catch((error: unknown) => {
      if (!cancelled) {
        setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) })
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  return state
}
