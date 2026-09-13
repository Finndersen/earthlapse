/**
 * Texture cache for the ancestor portrait, mirroring `scene/textureCache.ts`: a URL decodes onto
 * the GPU at most once. Plates are colour (sRGB); flow fields are data and must never be
 * colour-converted, so the kind is part of the cache key. Not unit tested (jsdom has no WebGL).
 */

import * as THREE from 'three'

export type PortraitTextureKind = 'colour' | 'flow'

const loader = new THREE.TextureLoader()
const cache = new Map<string, THREE.Texture>()
const inFlight = new Map<string, Promise<THREE.Texture>>()

function dataTexture(rgba: readonly number[]): THREE.Texture {
  const texture = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat)
  texture.needsUpdate = true
  return texture
}

/** Bound while the real plates load, so WebGL always has a texture object. */
export const PLATE_PLACEHOLDER: THREE.Texture = dataTexture([0, 0, 0, 255])
/** A zero displacement everywhere. */
export const FLOW_PLACEHOLDER: THREE.Texture = dataTexture([128, 128, 128, 255])

export function loadPortraitTexture(url: string, kind: PortraitTextureKind): Promise<THREE.Texture> {
  const key = `${kind}:${url}`
  const cached = cache.get(key)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = inFlight.get(key)
  if (pending !== undefined) return pending

  const promise = new Promise<THREE.Texture>((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = kind === 'colour' ? THREE.SRGBColorSpace : THREE.NoColorSpace
        texture.minFilter = THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.generateMipmaps = false
        cache.set(key, texture)
        inFlight.delete(key)
        resolve(texture)
      },
      undefined,
      (event) => {
        inFlight.delete(key)
        const message = event instanceof ErrorEvent ? event.message : String(event)
        reject(new Error(`failed to load portrait ${kind} texture ${url}: ${message}`))
      },
    )
  })
  inFlight.set(key, promise)
  return promise
}
