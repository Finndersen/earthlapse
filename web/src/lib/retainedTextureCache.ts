/**
 * A bounded, URL-keyed GPU texture cache whose eviction can never dispose a texture that is on
 * screen. Shared by the scene (`scene/textureCache.ts`) and ancestor portrait
 * (`layers/portraitTextures.ts`) caches; the globe's own caches predate it and trim against an
 * explicit keep-set instead (`globe/textureCache.ts`).
 *
 * Callers `retain` every texture they bind to a material, or may bind on a later frame, and
 * release it when they stop. Least-recently-used entries beyond `capacity` are disposed on every
 * insert and every `retain`, skipping retained ones; a release never trims. That ordering is
 * what makes a rebind safe: React runs an effect's cleanup (release the old pair) before its
 * next setup (retain the new pair) within the same commit, so a texture carried over from one
 * pair to the next is re-retained before anything can trim it.
 *
 * A texture read through `get` (a render-phase bind) or just inserted is most recently used, so
 * `capacity` only needs room for the loads that can land before its binder retains it. If a burst
 * of superseded loads evicts one anyway, drawing it still works (three.js re-uploads a disposed
 * texture on its next use), and its final release disposes it again so the re-upload cannot leak.
 */

import type * as THREE from 'three'

import { LruCache } from '@/globe/lru'

export interface RetainedTextureCache {
  /** The cached texture, marked most recently used — `undefined` unless `url` has fully loaded. */
  get(url: string): THREE.Texture | undefined
  /** Loads `url` at most once while cached; concurrent calls share one load. `onProgress` is
   *  called only for a load this call starts, not one it joins or a cache hit. */
  load(url: string, onProgress?: (fraction: number) => void): Promise<THREE.Texture>
  /** Protects `textures` from eviction until the returned release is called. `null`s and
   *  textures this cache does not hold are ignored. */
  retain(textures: readonly (THREE.Texture | null)[]): () => void
}

export type TextureFetcher = (url: string, onProgress?: (fraction: number) => void) => Promise<THREE.Texture>

export function createRetainedTextureCache(capacity: number, fetchTexture: TextureFetcher): RetainedTextureCache {
  const cache = new LruCache<THREE.Texture>(capacity, (texture) => texture.dispose())
  const urlByTexture = new Map<THREE.Texture, string>()
  const loaded = new WeakSet<THREE.Texture>()
  const retainCounts = new Map<THREE.Texture, number>()
  const inFlight = new Map<string, Promise<THREE.Texture>>()

  function trim(): void {
    const keep = new Set<string>()
    for (const texture of retainCounts.keys()) {
      const url = urlByTexture.get(texture)
      if (url !== undefined) keep.add(url)
    }
    cache.trim(keep)
    for (const [texture, url] of urlByTexture) {
      if (!cache.has(url)) urlByTexture.delete(texture)
    }
  }

  return {
    get: (url) => cache.get(url),

    load(url, onProgress) {
      const cached = cache.get(url)
      if (cached !== undefined) return Promise.resolve(cached)
      const pending = inFlight.get(url)
      if (pending !== undefined) return pending

      const promise = fetchTexture(url, onProgress).then(
        (texture) => {
          inFlight.delete(url)
          cache.set(url, texture)
          urlByTexture.set(texture, url)
          loaded.add(texture)
          trim()
          return texture
        },
        (error: unknown) => {
          inFlight.delete(url)
          throw error
        },
      )
      inFlight.set(url, promise)
      return promise
    },

    retain(textures) {
      const held = textures.filter((texture): texture is THREE.Texture => texture !== null)
      for (const texture of held) retainCounts.set(texture, (retainCounts.get(texture) ?? 0) + 1)
      trim()
      let released = false
      return () => {
        if (released) return
        released = true
        for (const texture of held) {
          const count = (retainCounts.get(texture) ?? 0) - 1
          if (count > 0) {
            retainCounts.set(texture, count)
            continue
          }
          retainCounts.delete(texture)
          if (loaded.has(texture) && !urlByTexture.has(texture)) texture.dispose()
        }
      }
    },
  }
}
