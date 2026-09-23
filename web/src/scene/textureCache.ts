/**
 * Module-level texture cache shared by every `SceneCanvasView` instance: a URL is decoded onto the
 * GPU at most once while cached, so re-scrubbing over recently seen scenes resolves instantly. Not
 * part of the pure `t -> value` contract (it does I/O and holds GPU-side state), so it lives
 * outside `transition.ts`/`drift.ts` and is exercised through `useScenePair`.
 *
 * Bounded (`lib/retainedTextureCache.ts`): `useScenePair` retains the pair it has bound, so
 * eviction only ever disposes scenes nothing is drawing. Thumbnails (ADR-051) have a cache of their
 * own, sized to hold every scene's: at 64 KB each they would otherwise evict full scenes by count.
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

import { sceneImageBytes } from './sceneImageBytes'

/** A scene is 2752x1536 RGBA, ~17 MB of GPU memory. Eight covers the bound pair, a requested pair
 *  still loading and `prefetch.ts`'s four decoded scenes (~135 MB). */
export const SCENE_CACHE_CAPACITY = 8

/** A thumbnail is 128x128 RGBA, 64 KB on the GPU; this holds every published scene's (~71) with
 *  room to grow, ~8 MB at most. */
export const SCENE_THUMBNAIL_CACHE_CAPACITY = 128

async function fetchSceneTexture(url: string, onProgress?: (fraction: number) => void): Promise<THREE.Texture> {
  const image = await fetchImage(url, onProgress, sceneImageBytes.load)
  const texture = new THREE.Texture(image)
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/** A thumbnail is the scene's centre square, so a wide viewport samples past its edges; mirroring
 *  continues the picture there instead of smearing its edge texels. */
async function fetchThumbnailTexture(url: string): Promise<THREE.Texture> {
  const texture = await fetchSceneTexture(url)
  texture.wrapS = THREE.MirroredRepeatWrapping
  texture.wrapT = THREE.MirroredRepeatWrapping
  return texture
}

const cache = createRetainedTextureCache(SCENE_CACHE_CAPACITY, fetchSceneTexture)
const thumbnailCache = createRetainedTextureCache(SCENE_THUMBNAIL_CACHE_CAPACITY, fetchThumbnailTexture)

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

export function getCachedSceneThumbnail(url: string): THREE.Texture | undefined {
  return thumbnailCache.get(url)
}

export function loadSceneThumbnail(url: string): Promise<THREE.Texture> {
  return thumbnailCache.load(url)
}

/** Protects bound textures, full scenes and thumbnails alike, from eviction until the returned
 *  release is called. */
export function retainSceneTextures(textures: readonly (THREE.Texture | null)[]): () => void {
  const releaseScenes = cache.retain(textures)
  const releaseThumbnails = thumbnailCache.retain(textures)
  return () => {
    releaseScenes()
    releaseThumbnails()
  }
}
