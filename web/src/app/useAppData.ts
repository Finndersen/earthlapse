'use client'

/**
 * Loads the manifest, then every layer's data file. The page renders as soon as the manifest is
 * in; each layer's data joins `layerData` as it lands. A layer absent from `layerData` has not
 * loaded yet, and its consumer renders nothing for it rather than a placeholder value — so a
 * loading layer never shows a wrong value, only none. A consumer whose output depends on several
 * layers together, or on whether a layer is published at all, waits for all of them
 * (`Experience.tsx`'s `layersLoaded`), since "not loaded yet" and "not published" look alike.
 *
 * Any failure — the manifest 404s on both the real and stub URL, a layer's data file 404s, a
 * malformed JSON payload — surfaces as `status: 'error'`, per `loadManifest`'s own "throw loudly,
 * never render half a broken manifest" contract, even if the page has already rendered.
 */

import { useEffect, useState } from 'react'

import { loadLayerData, loadManifest, type LayerData } from '@/shell'
import type { Manifest } from '@/types/manifest'

export type AppDataState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; manifest: Manifest; isStub: boolean; layerData: ReadonlyMap<string, LayerData> }

export function useAppData(): AppDataState {
  const [state, setState] = useState<AppDataState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function run(): Promise<void> {
      const { manifest, isStub } = await loadManifest()
      if (cancelled) return
      setState({ status: 'ready', manifest, isStub, layerData: new Map() })

      const layerData = new Map<string, LayerData>()
      await Promise.all(
        manifest.layers.map(async (entry) => {
          const data = await loadLayerData(manifest, entry)
          if (cancelled) return
          layerData.set(entry.id, data)
          const snapshot = new Map(layerData)
          setState((previous) => (previous.status === 'ready' ? { ...previous, layerData: snapshot } : previous))
        }),
      )
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
