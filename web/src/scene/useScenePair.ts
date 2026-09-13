/**
 * Binds `from`/`to` URLs to loaded `THREE.Texture`s, without ever handing the caller a blank
 * frame: the previously bound pair stays visible until the newly requested pair has both
 * finished loading (mirrors `globe/useGlobeTexturePair.ts`). `SceneCanvasView` is the only
 * consumer.
 */

import { useEffect, useRef, useState } from 'react'
import type * as THREE from 'three'

import { loadSceneTexture } from './textureCache'

interface BoundPair {
  fromUrl: string
  toUrl: string
  fromTex: THREE.Texture
  toTex: THREE.Texture
}

export interface ScenePair {
  fromTex: THREE.Texture | null
  toTex: THREE.Texture | null
  /** Whether any pair has ever loaded — false only before the very first pair resolves. */
  ready: boolean
}

export function useScenePair(fromUrl: string, toUrl: string): ScenePair {
  const [bound, setBound] = useState<BoundPair | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    const alreadyBound = bound !== null && bound.fromUrl === fromUrl && bound.toUrl === toUrl
    if (alreadyBound) return undefined

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
    ready: bound !== null,
  }
}
