/**
 * Module-level texture cache shared by every `Globe` instance. Loads each URL at most once —
 * repeated blends (e.g. scrubbing back over already-seen frames) resolve instantly from
 * cache instead of re-fetching. Not itself part of the pure `t -> value` contract (it does
 * I/O and holds GPU-side state), so it lives outside `blend.ts` and is exercised through the
 * component, not unit tested (jsdom has no WebGL/image decoding).
 */

import * as THREE from 'three'

const loader = new THREE.TextureLoader()
const cache = new Map<string, THREE.Texture>()
const inFlight = new Map<string, Promise<THREE.Texture>>()

/** A 1x1 opaque black texture bound to the shader's samplers while the real pair is still
 *  loading. `uHasData` is 0 in that state so its color never actually shows — this exists
 *  only so WebGL always has a valid texture object bound, never `null`. */
export const PLACEHOLDER_TEXTURE: THREE.Texture = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat)
  texture.needsUpdate = true
  return texture
})()

export function loadTexture(url: string): Promise<THREE.Texture> {
  const cached = cache.get(url)
  if (cached !== undefined) return Promise.resolve(cached)

  const pending = inFlight.get(url)
  if (pending !== undefined) return pending

  const promise = new Promise<THREE.Texture>((resolve, reject) => {
    loader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace
        texture.minFilter = THREE.LinearFilter
        texture.generateMipmaps = false
        // The fragment shader's UV convention (see shaders.ts) assumes v=0 samples row 0 of
        // the source image (the top, i.e. north) — three.js's default flipY would instead
        // hand it row 0 of a vertically-flipped image.
        texture.flipY = false
        cache.set(url, texture)
        inFlight.delete(url)
        resolve(texture)
      },
      undefined,
      (event) => {
        inFlight.delete(url)
        const message = event instanceof ErrorEvent ? event.message : String(event)
        reject(new Error(`failed to load globe texture ${url}: ${message}`))
      },
    )
  })
  inFlight.set(url, promise)
  return promise
}
