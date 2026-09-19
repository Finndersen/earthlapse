/**
 * Module-level globe texture cache shared by every `Globe` instance: each URL is fetched and
 * decoded at most once while cached, and concurrent requests for one URL share a single load.
 * Does I/O and holds GPU state, so it sits outside the pure `t -> value` contract in `blend.ts`;
 * its eviction policy lives in the unit-tested `lru.ts`.
 *
 * One texture per PaleoDEM epoch (109, ADR-013) would be ~218 MB of RGBA on the GPU if nothing
 * were evicted, so the cache is bounded. `useGlobeTexturePair` calls `trimGlobeTextures(keep)`
 * after binding a pair, passing the bound pair plus the preload window, so a texture on screen is
 * never disposed.
 *
 * Decoding goes through `createImageBitmap`, which decodes off the main thread; an
 * `HTMLImageElement` would decode synchronously on first upload and hitch playback.
 */

import * as THREE from 'three'

import { LruCache } from './lru'

/** 1024x512 RGBA is 2 MB of GPU memory each: 16 textures ≈ 32 MB, enough for the bound pair,
 *  a preload window of a few frames each way and some scrub-back history. */
const CACHE_CAPACITY = 16

const cache = new LruCache<THREE.Texture>(CACHE_CAPACITY, disposeTexture)
const inFlight = new Map<string, Promise<THREE.Texture>>()

/** A 1x1 opaque black texture bound to the shader's samplers while the real pair is still
 *  loading. `uHasData` is 0 in that state so its color never actually shows — this exists
 *  only so WebGL always has a valid texture object bound, never `null`. */
export const PLACEHOLDER_TEXTURE: THREE.Texture = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat)
  texture.needsUpdate = true
  return texture
})()

function disposeTexture(texture: THREE.Texture): void {
  texture.dispose()
  const image: unknown = texture.image
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close()
}

async function fetchTexture(url: string): Promise<THREE.Texture> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`failed to load globe texture ${url}: HTTP ${response.status}`)
  const bitmap = await createImageBitmap(await response.blob())
  const texture = new THREE.Texture(bitmap)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  // The fragment shader's UV convention (see shaders.ts) assumes v=0 samples row 0 of the
  // source image (the top, i.e. north). An ImageBitmap is uploaded unflipped; three.js only
  // honours flipY for other image sources, so this states the convention rather than
  // changing it.
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

export function loadTexture(url: string): Promise<THREE.Texture> {
  const cached = cache.get(url)
  if (cached !== undefined) return Promise.resolve(cached)

  const pending = inFlight.get(url)
  if (pending !== undefined) return pending

  const promise = fetchTexture(url).then(
    (texture) => {
      inFlight.delete(url)
      cache.set(url, texture)
      return texture
    },
    (error: unknown) => {
      inFlight.delete(url)
      throw error
    },
  )
  inFlight.set(url, promise)
  return promise
}

/** Evicts least-recently-used textures beyond capacity, never one whose URL is in `keep`.
 *  `aggressive` (ADR-030) evicts everything not in `keep` regardless of capacity — see
 *  `lru.ts`'s own doc comment on `LruCache.trim` for why the human-era basemap needs this. */
export function trimGlobeTextures(keep: ReadonlySet<string>, options?: { aggressive?: boolean }): void {
  cache.trim(keep, options)
}
