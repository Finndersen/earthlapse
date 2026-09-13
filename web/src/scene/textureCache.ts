/**
 * Module-level texture cache shared by every `SceneCanvasView` instance, mirroring
 * `globe/textureCache.ts`'s pattern: a URL is decoded onto the GPU at most once, so
 * re-scrubbing over already-seen scenes resolves instantly instead of re-fetching. Not part
 * of the pure `t -> value` contract (it does I/O and holds GPU-side state), so it lives
 * outside `transition.ts`/`drift.ts` and is exercised through `useScenePair`, not unit
 * tested directly (jsdom has no WebGL/image decoding).
 */

import * as THREE from 'three'

const loader = new THREE.TextureLoader()
const cache = new Map<string, THREE.Texture>()
const inFlight = new Map<string, Promise<THREE.Texture>>()

/** A 1x1 opaque black texture bound to the shader's samplers while the real pair is still
 *  loading, so WebGL always has a valid texture object, never `null`. */
export const PLACEHOLDER_TEXTURE: THREE.Texture = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat)
  texture.needsUpdate = true
  return texture
})()

export function loadSceneTexture(url: string): Promise<THREE.Texture> {
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
        cache.set(url, texture)
        inFlight.delete(url)
        resolve(texture)
      },
      undefined,
      (event) => {
        inFlight.delete(url)
        const message = event instanceof ErrorEvent ? event.message : String(event)
        reject(new Error(`failed to load scene texture ${url}: ${message}`))
      },
    )
  })
  inFlight.set(url, promise)
  return promise
}
