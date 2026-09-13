/**
 * Binds a `GlobeBlend`'s two refs to loaded `THREE.Texture`s, without ever handing the caller
 * a blank frame, and warms the frames about to be needed. `Globe.tsx` is the only consumer.
 */

import { useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'

import type { GlobeBlend } from './blend'
import { loadTexture, trimGlobeTextures } from './textureCache'

interface BoundTexturePair {
  beforeUrl: string
  afterUrl: string
  beforeTex: THREE.Texture
  afterTex: THREE.Texture
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
 */
export function useGlobeTexturePair(blend: GlobeBlend | null, preloadUrls: readonly string[]): GlobeTexturePair {
  const [bound, setBound] = useState<BoundTexturePair | null>(null)
  const requestIdRef = useRef(0)
  const frozenMixRef = useRef(0)

  useEffect(() => {
    if (blend === null) return undefined
    const alreadyBound =
      bound !== null && bound.beforeUrl === blend.beforeUrl && bound.afterUrl === blend.afterUrl
    if (alreadyBound) return undefined

    const requestId = ++requestIdRef.current
    let cancelled = false
    void Promise.all([loadTexture(blend.beforeUrl), loadTexture(blend.afterUrl)])
      .then(([beforeTex, afterTex]) => {
        // A newer request superseded this one (t moved again before this pair finished
        // loading) — drop the stale result rather than binding it out of order.
        if (cancelled || requestIdRef.current !== requestId) return
        setBound({ beforeUrl: blend.beforeUrl, afterUrl: blend.afterUrl, beforeTex, afterTex })
      })
      .catch((error: unknown) => {
        // Keep showing whatever pair is already bound. A bad ref is a data problem to
        // surface upstream (earthtime publish), not something to paper over here.
        console.error(error)
      })
    return () => {
      cancelled = true
    }
  }, [blend, bound])

  // Keyed on the joined URLs, not the array: `Globe` recomputes the window every frame during
  // playback, but it only changes when `t` crosses into a new frame pair.
  const preloadKey = preloadUrls.join('\n')
  useEffect(() => {
    if (preloadKey === '') return
    for (const url of preloadKey.split('\n')) {
      loadTexture(url).catch((error: unknown) => console.error(error))
    }
  }, [preloadKey])

  // Trim only once a pair is bound, keeping it, the pair being requested and the preload
  // window, so eviction can never dispose a texture that is on screen or about to be.
  const blendKey = blend === null ? '' : `${blend.beforeUrl}\n${blend.afterUrl}`
  useEffect(() => {
    if (bound === null) return
    const keep = new Set([bound.beforeUrl, bound.afterUrl])
    for (const url of blendKey.split('\n')) if (url !== '') keep.add(url)
    for (const url of preloadKey.split('\n')) if (url !== '') keep.add(url)
    trimGlobeTextures(keep)
  }, [bound, blendKey, preloadKey])

  const matchesBound =
    bound !== null && blend !== null && bound.beforeUrl === blend.beforeUrl && bound.afterUrl === blend.afterUrl
  const mix = matchesBound ? blend.alpha : frozenMixRef.current

  useEffect(() => {
    frozenMixRef.current = mix
  })

  return {
    beforeTex: bound?.beforeTex ?? null,
    afterTex: bound?.afterTex ?? null,
    mix,
    texturesReady: bound !== null,
  }
}
