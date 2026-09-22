'use client'

/**
 * The scene the experience opens on, and the load that gates first paint: the loading screen
 * stays up until that scene's textures are in `scene/textureCache.ts`, so `useScenePair` binds
 * them in the very render that mounts it rather than showing its black placeholder first.
 */

import { useEffect, useMemo, useState } from 'react'

import { supportsWebGL } from '@/lib/webgl'
import { resolveAssetUrl, sceneAt } from '@/scene'
import { loadSceneTexture } from '@/scene/textureCache'
import type { GeoTime } from '@/types/layer'
import type { Manifest } from '@/types/manifest'

/** The experience opens on the oldest scene; `null` when the manifest has none. */
export function initialSceneT(manifest: Manifest): GeoTime | null {
  if (manifest.scenes.length === 0) return null
  return manifest.scenes.reduce((a, b) => (b.t > a.t ? b : a)).t
}

/** The distinct image URLs of the scene pair shown at the initial `t`. */
export function firstSceneUrls(manifest: Manifest): string[] {
  const t = initialSceneT(manifest)
  if (t === null) return []
  const { from, to } = sceneAt(manifest.scenes, t)
  return [...new Set([from.image, to.image])].map((image) => resolveAssetUrl(manifest.assetBase, image))
}

/** Share of the loading bar the manifest fills. It reports no byte progress of its own, so it
 *  advances the bar in one step; the first scene's download fills the rest. */
const MANIFEST_SHARE = 0.15

/** 0..1 across everything that gates first paint: the manifest, then the first scene's images
 *  (`sceneFractions`, one per URL). */
export function loadingProgress(manifestLoaded: boolean, sceneFractions: readonly number[]): number {
  if (!manifestLoaded) return 0
  if (sceneFractions.length === 0) return 1
  const scene = sceneFractions.reduce((sum, f) => sum + Math.min(1, Math.max(0, f)), 0) / sceneFractions.length
  return MANIFEST_SHARE + (1 - MANIFEST_SHARE) * scene
}

export interface FirstSceneLoad {
  /** Download fraction per first-scene URL, in `firstSceneUrls` order. */
  fractions: readonly number[]
  /** Every first-scene load has finished, successfully or not. A failure is logged and left to
   *  `SceneView`, which keeps retrying through its own loads; it never holds the page back. */
  settled: boolean
}

/** Starts the first scene's texture loads as soon as `manifest` is known. Without WebGL the
 *  `<img>` fallback loads its own images, so nothing is gated on the texture cache. */
export function useFirstSceneLoad(manifest: Manifest | null): FirstSceneLoad {
  const urls = useMemo(() => (manifest === null || !supportsWebGL() ? [] : firstSceneUrls(manifest)), [manifest])
  const [fractions, setFractions] = useState<readonly number[]>([])
  const [settledCount, setSettledCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    setFractions(urls.map(() => 0))
    setSettledCount(0)
    urls.forEach((url, i) => {
      const report = (fraction: number): void => {
        if (!cancelled) setFractions((previous) => previous.map((f, j) => (j === i ? fraction : f)))
      }
      loadSceneTexture(url, report)
        .then(() => report(1))
        .catch((error: unknown) => console.error(error))
        .finally(() => {
          if (!cancelled) setSettledCount((n) => n + 1)
        })
    })
    return () => {
      cancelled = true
    }
  }, [urls])

  return { fractions, settled: manifest !== null && settledCount >= urls.length }
}
