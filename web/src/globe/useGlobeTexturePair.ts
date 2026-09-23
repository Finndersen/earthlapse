/**
 * Binds a `GlobeBlend`'s two refs to loaded `THREE.Texture`s without ever handing the caller a
 * blank frame, and warms the frames about to be needed. `Globe.tsx` is the only consumer:
 * directly for the PaleoDEM/Merdith pair, and via the `cache` option for the human-era basemap
 * and HYDE density overlay (ADR-030, ADR-031 amendment), which need different cache instances
 * (mipmapped, differently byte-capped, different `colorSpace` — `humanEraTextureCache.ts`) but
 * the same "never blank, trim once bound" discipline. Parameterising the cache rather than
 * duplicating the hook keeps that discipline in one place.
 */

import { useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'

import type { GlobeBlend } from './blend'
import { loadTexture, trimGlobeTextures } from './textureCache'

export interface GlobeTextureCache {
  loadTexture(url: string): Promise<THREE.Texture>
  trimTextures(keep: ReadonlySet<string>, options?: { aggressive?: boolean }): void
}

const PALEODEM_CACHE: GlobeTextureCache = { loadTexture, trimTextures: trimGlobeTextures }

interface BoundTexturePair {
  beforeUrl: string
  afterUrl: string
  beforeTex: THREE.Texture
  afterTex: THREE.Texture
  resetKey: number
  sourceKey: string
}

export interface GlobeTexturePair {
  beforeTex: THREE.Texture | null
  afterTex: THREE.Texture | null
  /** 0 -> beforeTex, 1 -> afterTex. Tracks the live blend alpha while the bound pair matches
   *  it; frozen at its last live value while a newer pair is still loading, so the visible
   *  pair and its mix factor never disagree. */
  mix: number
  /** Whether a texture pair is currently bound and ready to render — false until the first pair
   *  for the current `resetKey`/`sourceKey` has loaded. Deliberately independent of whether
   *  `blend` is currently null: `Globe` gates the out-of-domain look on `blend` itself, not on this. */
  texturesReady: boolean
}

/**
 * `preloadUrls` should come from `globePreloadUrls`. Preloads are fire-and-forget: a failure is
 * logged and the frame is fetched again when it is actually needed.
 *
 * Options are an object rather than trailing positional arguments, which would leave call sites
 * reading as `useGlobeTexturePair(blend, preload, webgl, undefined, true)`.
 */
export interface UseGlobeTexturePairOptions {
  /** Gates every fetch and decode this hook does, bound pair and preload window alike —
   *  `Globe.tsx` passes `false` when `!supportsWebGL()`, since without a GL context to display a
   *  texture, fetching and decoding frames is pure waste, worst on the devices least able to
   *  afford it. `false` returns the same "nothing bound yet" shape as before the first pair
   *  loads. Defaults to `true`. */
  enabled?: boolean
  /** Defaults to the PaleoDEM/Merdith LRU (`textureCache.ts`); the human-era basemap and HYDE
   *  overlay pass their own instances (`humanEraTextureCache.ts`). */
  cache?: GlobeTextureCache
  /** Threaded into `cache.trimTextures`'s `aggressive` option (ADR-030). `Globe.tsx` sets it once
   *  `t` is well inside the human-era basemap span, so the PaleoDEM cache stops idle-holding
   *  frames nothing on screen needs (see `LruCache.trim`). */
  aggressiveTrim?: boolean
  /** Bumped by the caller to force a fresh fetch of the bound pair even though its URLs haven't
   *  changed: a `beforeUrl`/`afterUrl` match says nothing about whether the *cache's* copy is
   *  still usable. `Globe.tsx` bumps this after a WebGL context loss for the two human-era pairs,
   *  whose cache was just cleared because their textures' backing `ImageBitmap`s were closed and
   *  unrecoverable. Without it, `bound` would point at the same permanently-blank `THREE.Texture`
   *  objects forever. Only its identity across renders matters; defaults to `0`. */
  resetKey?: number
  /** Identifies the data `blend` is drawn from. A pair bound for a different `sourceKey` reads as
   *  nothing bound, so a caller that switches source (`Globe.tsx`'s overlay kinds share this one
   *  hook) never renders the previous source's texels through the new source's decoding. Within
   *  one source the previous pair stays bound while the next loads, as usual. Defaults to `''`. */
  sourceKey?: string
}

export function useGlobeTexturePair(
  blend: GlobeBlend | null,
  preloadUrls: readonly string[],
  options: UseGlobeTexturePairOptions = {},
): GlobeTexturePair {
  const { enabled = true, cache = PALEODEM_CACHE, aggressiveTrim = false, resetKey = 0, sourceKey = '' } = options
  const [bound, setBound] = useState<BoundTexturePair | null>(null)
  const requestIdRef = useRef(0)
  const frozenMixRef = useRef(0)

  // A bound pair whose `resetKey` doesn't match the caller's current one is stale (see
  // `UseGlobeTexturePairOptions.resetKey`). It reads as "nothing bound" to every consumer, not
  // merely as a refetch trigger: the shader must stop sampling a texture whose backing
  // `ImageBitmap` is closed the instant the context is restored, not once the replacement has
  // loaded — otherwise every frame in between samples a detached `ImageBitmap` and logs "source
  // data has been detached". `bound` itself is left holding the stale texture as a last-resort
  // fallback if the refetch fails. A pair bound for another `sourceKey` is equally not current.
  const effectiveBound = bound !== null && bound.resetKey === resetKey && bound.sourceKey === sourceKey ? bound : null

  useEffect(() => {
    if (!enabled || blend === null) return undefined
    const alreadyBound = effectiveBound !== null && effectiveBound.beforeUrl === blend.beforeUrl && effectiveBound.afterUrl === blend.afterUrl
    if (alreadyBound) return undefined

    const requestId = ++requestIdRef.current
    let cancelled = false
    void Promise.all([cache.loadTexture(blend.beforeUrl), cache.loadTexture(blend.afterUrl)])
      .then(([beforeTex, afterTex]) => {
        // A newer request superseded this one (t moved again before this pair finished
        // loading) — drop the stale result rather than binding it out of order.
        if (cancelled || requestIdRef.current !== requestId) return
        setBound({ beforeUrl: blend.beforeUrl, afterUrl: blend.afterUrl, beforeTex, afterTex, resetKey, sourceKey })
      })
      .catch((error: unknown) => {
        // Keep showing whatever pair is already bound. A bad ref is a data problem to
        // surface upstream (earthtime publish), not something to paper over here.
        console.error(error)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, blend, effectiveBound, cache, resetKey, sourceKey])

  // Keyed on the joined URLs, not the array: `Globe` recomputes the window every frame during
  // playback, but it only changes when `t` crosses into a new frame pair.
  const preloadKey = preloadUrls.join('\n')
  useEffect(() => {
    if (!enabled || preloadKey === '') return
    for (const url of preloadKey.split('\n')) {
      cache.loadTexture(url).catch((error: unknown) => console.error(error))
    }
  }, [enabled, preloadKey, cache])

  // Trim only once a pair is bound, keeping it, the pair being requested and the preload
  // window, so eviction can never dispose a texture that is on screen or about to be.
  const blendKey = blend === null ? '' : `${blend.beforeUrl}\n${blend.afterUrl}`
  useEffect(() => {
    if (effectiveBound === null) return
    const keep = new Set([effectiveBound.beforeUrl, effectiveBound.afterUrl])
    for (const url of blendKey.split('\n')) if (url !== '') keep.add(url)
    for (const url of preloadKey.split('\n')) if (url !== '') keep.add(url)
    cache.trimTextures(keep, { aggressive: aggressiveTrim })
  }, [effectiveBound, blendKey, preloadKey, cache, aggressiveTrim])

  const matchesBound =
    effectiveBound !== null && blend !== null && effectiveBound.beforeUrl === blend.beforeUrl && effectiveBound.afterUrl === blend.afterUrl
  const mix = matchesBound ? blend.alpha : frozenMixRef.current

  useEffect(() => {
    frozenMixRef.current = mix
  })

  return {
    beforeTex: effectiveBound?.beforeTex ?? null,
    afterTex: effectiveBound?.afterTex ?? null,
    mix,
    texturesReady: effectiveBound !== null,
  }
}
