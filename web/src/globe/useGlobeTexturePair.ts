/**
 * Binds a `GlobeBlend`'s two refs to loaded `THREE.Texture`s, without ever handing the caller
 * a blank frame, and warms the frames about to be needed. `Globe.tsx` is the only consumer —
 * of this hook directly for the PaleoDEM/Merdith pair, and (via the optional `cache` param) for
 * the human-era basemap and the HYDE population-density overlay too (ADR-030, ADR-031 amendment),
 * which need different cache instances (mipmapped, differently byte-capped, a different
 * `colorSpace` — `humanEraTextureCache.ts`) but exactly the same "never blank, trim once bound"
 * discipline.
 * Parameterising the cache rather than duplicating this hook keeps that discipline in one place.
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
}

export interface GlobeTexturePair {
  beforeTex: THREE.Texture | null
  afterTex: THREE.Texture | null
  /** 0 -> beforeTex, 1 -> afterTex. Tracks the live blend alpha while the bound pair matches
   *  it; frozen at its last live value while a newer pair is still loading, so the visible
   *  pair and its mix factor never disagree. */
  mix: number
  /** Whether any texture pair is currently bound and ready to render — false only before the
   *  very first pair has loaded. Deliberately independent of whether `blend` is currently
   *  null: `Globe` gates the out-of-domain look on `blend` itself, not on this. */
  texturesReady: boolean
}

/**
 * `preloadUrls` should come from `globePreloadUrls`. Preloads are fire-and-forget: a failure
 * is logged and the frame is simply fetched again when it is actually needed.
 *
 * `enabled` (default `true`) gates every fetch and decode this hook does, bound pair and
 * preload window alike — `Globe.tsx` passes `false` when `!supportsWebGL()`: without a GL
 * context to ever display a texture, fetching and decoding PaleoDEM/Merdith frames is pure
 * waste, worst on exactly the devices least able to afford it. `false` returns the same
 * "nothing bound yet" shape `texturesReady: false` already means before the first pair loads,
 * so a caller that ignores WebGL support entirely still gets a well-formed, inert result.
 *
 * `options.cache` (default the PaleoDEM/Merdith LRU, `textureCache.ts`) lets the same binding
 * logic serve a different texture cache — the human-era basemap and HYDE overlay each get their
 * own instance (`humanEraTextureCache.ts`) rather than sharing PaleoDEM's, per this module's own
 * doc comment. `options.aggressiveTrim` (ADR-030) is threaded straight into `cache.trimTextures`'s
 * own `aggressive` option — `Globe.tsx` sets it once `t` is well inside the human-era basemap
 * span, so the PaleoDEM cache doesn't idle-hold frames nothing on screen needs (`lru.ts`'s own
 * doc comment on `LruCache.trim`). An options object, not two more positional booleans/objects
 * tacked onto the end: `useGlobeTexturePair(blend, preload, webgl, undefined, true)` reads as
 * "what are the third and fifth arguments" at every call site otherwise.
 */
export interface UseGlobeTexturePairOptions {
  /** Gates every fetch and decode this hook does, bound pair and preload window alike —
   *  `Globe.tsx` passes `false` when `!supportsWebGL()`: without a GL context to ever display a
   *  texture, fetching and decoding frames is pure waste, worst on exactly the devices least
   *  able to afford it. `false` returns the same "nothing bound yet" shape `texturesReady: false`
   *  already means before the first pair loads. Defaults to `true`. */
  enabled?: boolean
  cache?: GlobeTextureCache
  aggressiveTrim?: boolean
  /** Bumped by the caller to force a fresh fetch of the currently bound pair even though its
   *  URLs haven't changed — the `beforeUrl`/`afterUrl` match that normally short-circuits
   *  re-fetching says nothing about whether the *cache's* copy of those textures is still
   *  usable. `Globe.tsx` bumps this after a WebGL context loss for the two human-era pairs
   *  (basemap, population density), whose cache was just cleared (`HumanEraTextureCache.clear`) because their
   *  textures' backing `ImageBitmap`s were already closed and unrecoverable
   *  (`humanEraTextureCache.ts`'s own doc comment) — without this, `bound` would keep pointing
   *  at the same (now permanently blank) `THREE.Texture` objects forever, since their URLs never
   *  changed. Only its identity across renders matters, not its value; defaults to `0`. */
  resetKey?: number
}

export function useGlobeTexturePair(
  blend: GlobeBlend | null,
  preloadUrls: readonly string[],
  options: UseGlobeTexturePairOptions = {},
): GlobeTexturePair {
  const { enabled = true, cache = PALEODEM_CACHE, aggressiveTrim = false, resetKey = 0 } = options
  const [bound, setBound] = useState<BoundTexturePair | null>(null)
  const requestIdRef = useRef(0)
  const frozenMixRef = useRef(0)

  // A bound pair whose own `resetKey` doesn't match the caller's current one is stale — the
  // caller only bumps `resetKey` after a WebGL context loss, once the cache's own copy of these
  // exact textures is unrecoverable (`UseGlobeTexturePairOptions.resetKey`'s own doc comment).
  // Treated as "nothing bound" everywhere below, not just to trigger the refetch this also
  // causes: the shader must stop sampling a texture whose backing `ImageBitmap` is already closed
  // the instant the context is restored, not only once the replacement finishes loading — left
  // bound in the meantime, every frame in between samples a detached `ImageBitmap` and logs
  // "source data has been detached". `bound` itself is left untouched (still holds the stale
  // texture, in case the refetch below fails and there is nothing better to fall back to) —
  // `effectiveBound` is just what every *consumer* of it, including the returned pair, sees.
  const effectiveBound = bound !== null && bound.resetKey === resetKey ? bound : null

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
        setBound({ beforeUrl: blend.beforeUrl, afterUrl: blend.afterUrl, beforeTex, afterTex, resetKey })
      })
      .catch((error: unknown) => {
        // Keep showing whatever pair is already bound. A bad ref is a data problem to
        // surface upstream (earthtime publish), not something to paper over here.
        console.error(error)
      })
    return () => {
      cancelled = true
    }
  }, [enabled, blend, effectiveBound, cache, resetKey])

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
