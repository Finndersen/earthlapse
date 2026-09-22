/**
 * Binds an older/younger plate pair, plus the forward/backward flow textures between them when a
 * morph is computed, to loaded `THREE.Texture`s — without ever handing the caller a blank frame:
 * the previously bound set stays visible until the newly requested set has *every* texture it
 * needs fully loaded (mirrors `scene/useScenePair.ts`). `flow` being `null` requests a plain
 * crossfade: only the two plate textures are awaited, and the bound set's `forwardUrl`/
 * `backwardUrl` are `null` too.
 *
 * When every texture a newly requested set needs is already in `portraitTextures`'s cache (the
 * common case at a morph boundary: the incoming plate was the outgoing pair's other half, or a
 * preloaded neighbour — `AncestorPortrait`'s `portraitNeighbourUrls`), the bind happens
 * synchronously during render rather than through the effect below — deferring even a cache hit
 * through `Promise.all(...).then(...)` costs a microtask, long enough for a caller's `alpha`/
 * flow-range uniforms (driven by the same `t`) to paint the OLD set's textures under the NEW
 * state: a one-frame flash of the previous ancestor.
 *
 * That fast path only closes the flash for the cache-hit case; a genuinely unloaded set (fast
 * playback, rapid scrubs, a cold cache) still has this stale-texture/new-uniform mismatch via the
 * effect path. `boundOlderUrl`/`boundYoungerUrl`/`boundForwardUrl`/`boundBackwardUrl` let a
 * caller tell bound from requested — `portraitRender.ts`'s `resolvePortraitRender` reconciles
 * them, called by `PortraitCanvas`.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type * as THREE from 'three'

import { getCachedPortraitTexture, loadPortraitTexture, retainPortraitTextures } from './portraitTextures'

/** Two PNG data textures bending the older plate into the younger one. Mirrors `PortraitMorph`
 *  (`@/types/layer`) but carries resolved URLs rather than manifest-relative paths — what
 *  `AncestorPortrait` hands to `PortraitCanvas` after `resolveAssetUrl`. Defined here rather than
 *  in `portraitRender.ts` so that module can depend on this one without a cycle back —
 *  one-directional, like `scene/sceneRender.ts`'s dependency on `useScenePair.ts`. */
export interface PortraitFlow {
  forwardUrl: string
  backwardUrl: string
  forwardRange: number
  backwardRange: number
}

interface BoundPortraitSet {
  olderUrl: string
  youngerUrl: string
  forwardUrl: string | null
  backwardUrl: string | null
  olderTex: THREE.Texture
  youngerTex: THREE.Texture
  forwardTex: THREE.Texture | null
  backwardTex: THREE.Texture | null
}

export interface PortraitPair {
  olderTex: THREE.Texture | null
  youngerTex: THREE.Texture | null
  forwardTex: THREE.Texture | null
  backwardTex: THREE.Texture | null
  /** URLs the bound textures actually belong to — `null` until the first set has bound (mirrors
   *  `ready`). May lag the most recently requested URLs, since this only updates once a newly
   *  requested set's textures have *all* loaded (`portraitRender.ts`'s `resolvePortraitRender`
   *  reconciles the two). `boundForwardUrl`/`boundBackwardUrl` are `null` before the first bind
   *  and whenever the bound set has no morph. */
  boundOlderUrl: string | null
  boundYoungerUrl: string | null
  boundForwardUrl: string | null
  boundBackwardUrl: string | null
  /** Whether any set has ever loaded — false only before the very first set resolves. */
  ready: boolean
}

export function usePortraitPair(olderUrl: string, youngerUrl: string, flow: PortraitFlow | null): PortraitPair {
  const forwardUrl = flow?.forwardUrl ?? null
  const backwardUrl = flow?.backwardUrl ?? null
  const [bound, setBound] = useState<BoundPortraitSet | null>(null)
  const requestIdRef = useRef(0)

  const alreadyBound =
    bound !== null &&
    bound.olderUrl === olderUrl &&
    bound.youngerUrl === youngerUrl &&
    bound.forwardUrl === forwardUrl &&
    bound.backwardUrl === backwardUrl

  if (!alreadyBound) {
    const cachedOlder = getCachedPortraitTexture(olderUrl)
    const cachedYounger = getCachedPortraitTexture(youngerUrl)
    const cachedForward = forwardUrl === null ? undefined : getCachedPortraitTexture(forwardUrl)
    const cachedBackward = backwardUrl === null ? undefined : getCachedPortraitTexture(backwardUrl)
    const flowReady = forwardUrl === null || (cachedForward !== undefined && cachedBackward !== undefined)
    // Render-phase update: every texture the requested set needs is already on the GPU, so bind
    // it in this same render instead of waiting for the effect + promise below (module doc
    // comment). React re-renders synchronously off this before painting, so `alreadyBound` above
    // sees the new set on the very next check rather than looping.
    if (cachedOlder !== undefined && cachedYounger !== undefined && flowReady) {
      setBound({
        olderUrl,
        youngerUrl,
        forwardUrl,
        backwardUrl,
        olderTex: cachedOlder,
        youngerTex: cachedYounger,
        forwardTex: cachedForward ?? null,
        backwardTex: cachedBackward ?? null,
      })
    }
  }

  useEffect(() => {
    const stillNeedsRequest =
      bound === null ||
      bound.olderUrl !== olderUrl ||
      bound.youngerUrl !== youngerUrl ||
      bound.forwardUrl !== forwardUrl ||
      bound.backwardUrl !== backwardUrl
    if (!stillNeedsRequest) return undefined

    const requestId = ++requestIdRef.current
    let cancelled = false
    void Promise.all([
      loadPortraitTexture(olderUrl),
      loadPortraitTexture(youngerUrl),
      forwardUrl === null ? Promise.resolve(null) : loadPortraitTexture(forwardUrl),
      backwardUrl === null ? Promise.resolve(null) : loadPortraitTexture(backwardUrl),
    ])
      .then(([olderTex, youngerTex, forwardTex, backwardTex]) => {
        // A newer request superseded this one (t moved again before this set finished
        // loading) — drop the stale result rather than binding it out of order.
        if (cancelled || requestIdRef.current !== requestId) return
        setBound({ olderUrl, youngerUrl, forwardUrl, backwardUrl, olderTex, youngerTex, forwardTex, backwardTex })
      })
      .catch((error: unknown) => {
        // Keep showing whatever set is already bound. A bad ref is a data problem to surface
        // upstream (earthtime publish), not something to paper over here.
        console.error(error)
      })
    return () => {
      cancelled = true
    }
  }, [olderUrl, youngerUrl, forwardUrl, backwardUrl, bound])

  // A layout effect, so the set is retained in the same commit that binds it.
  const olderTex = bound?.olderTex ?? null
  const youngerTex = bound?.youngerTex ?? null
  const forwardTex = bound?.forwardTex ?? null
  const backwardTex = bound?.backwardTex ?? null
  useLayoutEffect(
    () => retainPortraitTextures([olderTex, youngerTex, forwardTex, backwardTex]),
    [olderTex, youngerTex, forwardTex, backwardTex],
  )

  return {
    olderTex,
    youngerTex,
    forwardTex,
    backwardTex,
    boundOlderUrl: bound?.olderUrl ?? null,
    boundYoungerUrl: bound?.youngerUrl ?? null,
    boundForwardUrl: bound?.forwardUrl ?? null,
    boundBackwardUrl: bound?.backwardUrl ?? null,
    ready: bound !== null,
  }
}
