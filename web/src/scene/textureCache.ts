/**
 * Module-level texture cache shared by every `SceneCanvasView` instance: a URL is decoded onto the
 * GPU at most once while cached, so re-scrubbing over recently seen scenes resolves instantly. Not
 * part of the pure `t -> value` contract (it does I/O and holds GPU-side state), so it lives
 * outside `transition.ts`/`drift.ts` and is exercised through `useScenePair`.
 *
 * Bounded (`lib/retainedTextureCache.ts`): `useScenePair` retains the pair it has bound, so
 * eviction only ever disposes scenes nothing is drawing.
 *
 * Every texture uploads with `NoColorSpace`, so the sampler returns the stored bytes — the same
 * contract as `layers/portraitTextures.ts`. `shaders.ts` owns the transfer: a settled scene is
 * written out as sampled, matching `SceneFallbackView`'s `<img>`, and only the crossfade decodes
 * to linear light. Tagging scenes `SRGBColorSpace` here would have the GPU decode them a second
 * time on top of that, drawing every scene at about (code/255)^2.2.
 */

import * as THREE from 'three'

import { fetchImage } from '@/lib/fetchImage'
import { createRetainedTextureCache } from '@/lib/retainedTextureCache'

/** A scene is 2752x1536 RGBA, ~17 MB of GPU memory. Eight covers the bound pair, a requested pair
 *  still loading, the two preloaded neighbours and two of scrub-back history (~135 MB). */
export const SCENE_CACHE_CAPACITY = 8

async function fetchSceneTexture(url: string, onProgress?: (fraction: number) => void): Promise<THREE.Texture> {
  const image = await fetchImage(url, onProgress)
  const texture = new THREE.Texture(image)
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

const cache = createRetainedTextureCache(SCENE_CACHE_CAPACITY, fetchSceneTexture)

/** A 1x1 opaque black texture bound to the shader's samplers while the real pair is still
 *  loading, so WebGL always has a valid texture object, never `null`. */
export const PLACEHOLDER_TEXTURE: THREE.Texture = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat)
  texture.needsUpdate = true
  return texture
})()

/** Synchronous cache lookup — `undefined` unless `url` has already fully loaded. Lets a caller
 *  bind a pair without the microtask/frame `loadSceneTexture`'s promise always costs, even on
 *  a cache hit (`useScenePair` uses this to avoid a stale-pair flash at a scene checkpoint). */
export function getCachedSceneTexture(url: string): THREE.Texture | undefined {
  return cache.get(url)
}

export function loadSceneTexture(url: string, onProgress?: (fraction: number) => void): Promise<THREE.Texture> {
  return cache.load(url, onProgress)
}

/** Protects bound textures from eviction until the returned release is called. */
export function retainSceneTextures(textures: readonly (THREE.Texture | null)[]): () => void {
  return cache.retain(textures)
}
