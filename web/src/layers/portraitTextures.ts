/**
 * Texture cache for the ancestor portrait: a URL decodes onto the GPU at most once while cached.
 * Bounded (`lib/retainedTextureCache.ts`): `usePortraitPair` retains its bound set and
 * `PortraitCanvas` whatever it draws, so eviction only ever disposes textures nothing is drawing.
 *
 * Every texture uploads with `NoColorSpace`, so the sampler returns the stored bytes. Flow fields
 * are data. Plates stay sRGB-encoded because `portraitShaders.ts` owns the transfer: a settled
 * plate is written out as sampled, which is what the `<img>` fallback shows, and only the blend
 * between two plates decodes to linear light. Tagging plates `SRGBColorSpace` would have the GPU
 * decode them too, and the unencoded output would draw every plate at about (code/255)^2.2.
 */

import * as THREE from 'three'

import { createRetainedTextureCache } from '@/lib/retainedTextureCache'

/** A plate is 1024x1024 RGBA, ~4 MB of GPU memory; flow textures are smaller. Sixteen covers the
 *  bound set and a requested set (four each), the six-texture preload window and a little
 *  scrub-back history. */
export const PORTRAIT_CACHE_CAPACITY = 16

const loader = new THREE.TextureLoader()

function fetchPortraitTexture(url: string): Promise<THREE.Texture> {
  return new Promise<THREE.Texture>((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.NoColorSpace
        texture.minFilter = THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.generateMipmaps = false
        resolve(texture)
      },
      undefined,
      (event) => {
        const message = event instanceof ErrorEvent ? event.message : String(event)
        reject(new Error(`failed to load portrait texture ${url}: ${message}`))
      },
    )
  })
}

const cache = createRetainedTextureCache(PORTRAIT_CACHE_CAPACITY, fetchPortraitTexture)

function dataTexture(rgba: readonly number[]): THREE.Texture {
  const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat)
  texture.needsUpdate = true
  return texture
}

/** Bound while the real plates load, so WebGL always has a texture object. */
export const PLATE_PLACEHOLDER: THREE.Texture = dataTexture([0, 0, 0, 255])
/** A zero displacement everywhere. */
export const FLOW_PLACEHOLDER: THREE.Texture = dataTexture([128, 128, 128, 255])

/** Synchronous cache lookup — `undefined` unless `url` has already fully loaded. Lets a caller
 *  bind a set without the microtask/frame `loadPortraitTexture`'s promise always costs, even on
 *  a cache hit (`usePortraitPair` uses this to avoid a stale-set flash at a morph boundary,
 *  mirroring `scene/textureCache.ts`'s `getCachedSceneTexture`). */
export function getCachedPortraitTexture(url: string): THREE.Texture | undefined {
  return cache.get(url)
}

export function loadPortraitTexture(url: string): Promise<THREE.Texture> {
  return cache.load(url)
}

/** Protects bound or drawn textures from eviction until the returned release is called. */
export function retainPortraitTextures(textures: readonly (THREE.Texture | null)[]): () => void {
  return cache.retain(textures)
}
