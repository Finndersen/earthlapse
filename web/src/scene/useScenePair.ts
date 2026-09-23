/**
 * Binds the requested `from`/`to` scenes to loaded `THREE.Texture`s, without ever handing the
 * caller a blank frame (mirrors `globe/useGlobeTexturePair.ts`). `SceneCanvasView` is the only
 * consumer.
 *
 * Each end binds as a `SceneLayer` (`sceneLayer.ts`, ADR-051): its full image if loaded, else its
 * thumbnail, which `SceneQuad` draws softened until the full image lands and replaces it. The
 * requested pair binds as soon as both ends have either; until then the previously bound pair
 * stays on screen. Thumbnails are prefetched for every scene, so that wait is normally only the
 * very first load.
 *
 * When both ends are already in `textureCache`'s caches (the common case: a scene checkpoint
 * whose incoming scene was the outgoing pair's other half, or a prefetched one — `prefetch.ts`),
 * the bind happens synchronously during render rather than through the effect below. Deferring
 * even a cache hit through a promise costs a microtask, so the caller's `mix`/drift uniforms —
 * driven by the same `t` — would land in a render before the rebind, painting the OLD pair's
 * textures under the NEW state: a one-frame flash of the previous scene. `SceneFallbackView`'s
 * `useDecodedSrc` uses the same render-phase pattern for the same reason.
 *
 * When an end has neither texture yet (a cold cache), the bound layers keep describing the
 * *previous* pair while `t`-driven mix/drift have already moved on. Each layer's `url` lets a
 * caller tell the two apart: `sceneRender.ts`'s `resolveSceneRender` reconciles them, called by
 * `SceneCanvasView`.
 */

import { useEffect, useLayoutEffect, useState } from 'react'
import type * as THREE from 'three'

import { chooseSceneLayer, type SceneLayer } from './sceneLayer'
import {
  getCachedSceneTexture,
  getCachedSceneThumbnail,
  loadSceneTexture,
  loadSceneThumbnail,
  retainSceneTextures,
} from './textureCache'

export type BoundSceneLayer = SceneLayer<THREE.Texture>

export interface ScenePair {
  /** The layers actually bound — `null` until the first pair has bound. May lag the requested
   *  pair while an end has neither texture loaded; see `sceneRender.ts`'s `resolveSceneRender`. */
  from: BoundSceneLayer | null
  to: BoundSceneLayer | null
  /** Whether any pair has ever bound — false only before the very first pair resolves. */
  ready: boolean
}

interface BoundPair {
  from: BoundSceneLayer
  to: BoundSceneLayer
}

/** Textures this request's own loads resolved to, keyed by URL. Scoped to one request, so a load
 *  finishing after the request moved on can never bind out of order. */
interface Landed {
  requestKey: string
  textures: ReadonlyMap<string, THREE.Texture>
}

/**
 * Starts `url`'s full-image load, and its thumbnail's unless cached, until the full image is bound
 * (`sharp`), recording each texture as it lands for this request only. Both loads join any already
 * in flight in `textureCache`, so a re-run costs no second request.
 */
function useLayerLoads(
  url: string,
  thumbUrl: string,
  sharp: boolean,
  requestKey: string,
  setLanded: (update: (previous: Landed) => Landed) => void,
): void {
  useEffect(() => {
    if (sharp) return undefined
    let cancelled = false
    const land = (landedUrl: string) => (texture: THREE.Texture) => {
      if (cancelled) return
      setLanded((previous) => {
        const textures = new Map(previous.requestKey === requestKey ? previous.textures : [])
        textures.set(landedUrl, texture)
        return { requestKey, textures }
      })
    }
    // Keep showing whatever is already bound. A bad ref is a data problem to surface upstream
    // (earthtime publish), not something to paper over here.
    const report = (error: unknown): void => {
      if (!cancelled) console.error(error)
    }
    loadSceneTexture(url).then(land(url), report)
    if (getCachedSceneThumbnail(thumbUrl) === undefined) loadSceneThumbnail(thumbUrl).then(land(thumbUrl), report)
    return () => {
      cancelled = true
    }
  }, [url, thumbUrl, sharp, requestKey, setLanded])
}

function sameLayer(a: BoundSceneLayer, b: BoundSceneLayer): boolean {
  return a.url === b.url && a.full === b.full && a.thumb === b.thumb
}

export function useScenePair(fromUrl: string, fromThumbUrl: string, toUrl: string, toThumbUrl: string): ScenePair {
  const [bound, setBound] = useState<BoundPair | null>(null)
  const requestKey = [fromUrl, fromThumbUrl, toUrl, toThumbUrl].join('\n')
  const [landed, setLanded] = useState<Landed>({ requestKey, textures: new Map() })

  const landedTexture = (url: string): THREE.Texture | undefined =>
    landed.requestKey === requestKey ? landed.textures.get(url) : undefined
  const layerFor = (url: string, thumbUrl: string): BoundSceneLayer | null =>
    chooseSceneLayer(
      url,
      getCachedSceneTexture(url) ?? landedTexture(url),
      getCachedSceneThumbnail(thumbUrl) ?? landedTexture(thumbUrl),
    )

  const from = layerFor(fromUrl, fromThumbUrl)
  const to = layerFor(toUrl, toThumbUrl)
  // Render-phase update: both ends can be drawn now, so bind them in this same render instead of
  // waiting on the effect below (see module doc). React re-renders synchronously off this before
  // painting, and the comparison makes the next pass a no-op, not a loop.
  if (from !== null && to !== null && (bound === null || !sameLayer(bound.from, from) || !sameLayer(bound.to, to))) {
    setBound({ from, to })
  }

  const sharp = (layer: BoundSceneLayer | null): boolean => layer !== null && layer.full !== null
  useLayerLoads(fromUrl, fromThumbUrl, sharp(from), requestKey, setLanded)
  // A settled scene requests the same URLs at both ends; one set of loads covers both.
  useLayerLoads(toUrl, toThumbUrl, toUrl === fromUrl || sharp(to), requestKey, setLanded)

  // A layout effect, so the pair is retained in the same commit that binds it.
  const fromFull = bound?.from.full ?? null
  const fromThumb = bound?.from.thumb ?? null
  const toFull = bound?.to.full ?? null
  const toThumb = bound?.to.thumb ?? null
  useLayoutEffect(
    () => retainSceneTextures([fromFull, fromThumb, toFull, toThumb]),
    [fromFull, fromThumb, toFull, toThumb],
  )

  return { from: bound?.from ?? null, to: bound?.to ?? null, ready: bound !== null }
}
