/**
 * Texture cache for the ancestor portrait: a URL decodes onto the GPU at most once.
 *
 * Every texture uploads with `NoColorSpace`, so the sampler returns the stored bytes. Flow fields
 * are data. Plates stay sRGB-encoded because `portraitShaders.ts` owns the transfer: a settled
 * plate is written out as sampled, which is what the `<img>` fallback shows, and only the blend
 * between two plates decodes to linear light. Tagging plates `SRGBColorSpace` would have the GPU
 * decode them too, and the unencoded output would draw every plate at about (code/255)^2.2.
 */

import * as THREE from 'three'

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

export function loadPortraitTexture(url: string): Promise<THREE.Texture> {
  const cached = cache.get(url)
  if (cached !== undefined) return Promise.resolve(cached)
  const pending = inFlight.get(url)
  if (pending !== undefined) return pending

  const promise = new Promise<THREE.Texture>((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.NoColorSpace
        texture.minFilter = THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        texture.generateMipmaps = false
        cache.set(url, texture)
        inFlight.delete(url)
        resolve(texture)
      },
      undefined,
      (event) => {
        inFlight.delete(url)
        const message = event instanceof ErrorEvent ? event.message : String(event)
        reject(new Error(`failed to load portrait texture ${url}: ${message}`))
      },
    )
  })
  inFlight.set(url, promise)
  return promise
}
