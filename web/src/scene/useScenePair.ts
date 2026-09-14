/**
 * Binds `from`/`to` URLs to loaded `THREE.Texture`s, without ever handing the caller a blank
 * frame: the previously bound pair stays visible until the newly requested pair has both
 * finished loading (mirrors `globe/useGlobeTexturePair.ts`). `SceneCanvasView` is the only
 * consumer.
 *
 * When both of a newly requested pair's textures are already in `textureCache`'s cache (the
 * common case right at a scene checkpoint: the incoming texture was the outgoing pair's other
 * half, or a neighbour preloaded ahead of time — see `SceneView`'s `neighbourUrls`), the bind
 * happens synchronously during render rather than through the effect below. Deferring even a
 * cache hit through `Promise.all(...).then(...)` costs a microtask, so the caller's `mix`/drift
 * uniforms — driven by the same `t` this pair switch is — would land in a render before the
 * rebind, painting the OLD pair's textures under the NEW state: a one-frame flash of the
 * previous scene. `SceneFallbackView`'s `useDecodedSrc` uses the same render-phase pattern
 * against its own shared decoded-URL cache for the same reason.
 *
 * That render-phase fast path only closes the flash for the cache-hit case. When the newly
 * requested pair's texture genuinely is not loaded yet (fast playback, rapid scrubs, a cold
 * cache), `fromTex`/`toTex` below keep describing the *previous* pair while a caller computing
 * mix/drift straight from `t` has already moved on to the newly requested one — the same
 * stale-texture/new-uniform mismatch, just via the effect below instead of the fast path.
 * `boundFromUrl`/`boundToUrl` exist so a caller can tell the two apart: `sceneRender.ts`'s
 * `resolveSceneRender` reconciles them, and `SceneCanvasView` is the one that calls it.
 */

import { useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'

import { getCachedSceneTexture, loadSceneTexture } from './textureCache'

interface BoundPair {
  fromUrl: string
  toUrl: string
  fromTex: THREE.Texture
  toTex: THREE.Texture
}

export interface ScenePair {
  fromTex: THREE.Texture | null
  toTex: THREE.Texture | null
  /** URLs of the pair `fromTex`/`toTex` actually belong to — `null` until the very first pair
   *  has bound (mirrors `ready`). May lag the `fromUrl`/`toUrl` most recently requested of the
   *  hook: this only updates once a newly requested pair's textures have *both* loaded, so a
   *  caller that also drives other state (mix, drift) off the requested pair needs this to
   *  tell the two apart — see `sceneRender.ts`'s `resolveSceneRender`, which reconciles them. */
  boundFromUrl: string | null
  boundToUrl: string | null
  /** Whether any pair has ever loaded — false only before the very first pair resolves. */
  ready: boolean
}

export function useScenePair(fromUrl: string, toUrl: string): ScenePair {
  const [bound, setBound] = useState<BoundPair | null>(null)
  const requestIdRef = useRef(0)

  const alreadyBound = bound !== null && bound.fromUrl === fromUrl && bound.toUrl === toUrl
  if (!alreadyBound) {
    const cachedFrom = getCachedSceneTexture(fromUrl)
    const cachedTo = getCachedSceneTexture(toUrl)
    // Render-phase update: both halves are already on the GPU, so bind them in this same
    // render instead of waiting for the effect + promise below (see the module doc comment).
    // React re-renders synchronously off this before painting, so `alreadyBound` above sees
    // the new pair on the very next check rather than looping.
    if (cachedFrom !== undefined && cachedTo !== undefined) {
      setBound({ fromUrl, toUrl, fromTex: cachedFrom, toTex: cachedTo })
    }
  }

  useEffect(() => {
    const stillNeedsRequest = bound === null || bound.fromUrl !== fromUrl || bound.toUrl !== toUrl
    if (!stillNeedsRequest) return undefined

    const requestId = ++requestIdRef.current
    let cancelled = false
    void Promise.all([loadSceneTexture(fromUrl), loadSceneTexture(toUrl)])
      .then(([fromTex, toTex]) => {
        // A newer request superseded this one (t moved again before this pair finished
        // loading) — drop the stale result rather than binding it out of order.
        if (cancelled || requestIdRef.current !== requestId) return
        setBound({ fromUrl, toUrl, fromTex, toTex })
      })
      .catch((error: unknown) => {
        // Keep showing whatever pair is already bound. A bad ref is a data problem to
        // surface upstream (earthtime publish), not something to paper over here.
        console.error(error)
      })
    return () => {
      cancelled = true
    }
  }, [fromUrl, toUrl, bound])

  return {
    fromTex: bound?.fromTex ?? null,
    toTex: bound?.toTex ?? null,
    boundFromUrl: bound?.fromUrl ?? null,
    boundToUrl: bound?.toUrl ?? null,
    ready: bound !== null,
  }
}
