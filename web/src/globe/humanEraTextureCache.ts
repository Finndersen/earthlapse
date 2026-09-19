/**
 * A second, byte-capped texture cache (`ByteCappedCache`), separate from the PaleoDEM LRU
 * (`textureCache.ts`), for human-era globe layers whose texture is much higher resolution than
 * PaleoDEM's or holds numeric data rather than colour: the Natural Earth II basemap
 * (`sources/basemap`, ADR-030) and the HYDE population-density overlay (`densityTextureCache`,
 * ADR-031 amendment).
 *
 * Two things the PaleoDEM cache deliberately does *not* do, both needed here:
 *
 * - **Mipmaps.** PaleoDEM's 1024x512 frames are close to their on-screen size at every zoom this
 *   project ships, so `generateMipmaps: false` is fine there. The basemap tiers are far higher
 *   resolution (2048x1024 / 4096x2048) on the same small sphere and alias badly without mipmaps.
 *   A numeric overlay needs them for a different reason even at PaleoDEM's own resolution: its
 *   value can change sharply between adjacent texels (a HYDE gridcell's land-use split flips hard
 *   across a boundary — the Sahel/Sahara fringe alternates between near-0 and near-255 within a
 *   one-degree box), and minifying the globe otherwise makes the GPU bilinear-sample only the 2x2
 *   texels nearest each screen pixel, scattering full-strength hits across an area whose true
 *   average is tiny (a saturated band across the Sahel at orb size). `createHumanEraTextureCache`
 *   therefore takes a `mipmapStrategy` per instance rather than a bare `generateMipmaps` boolean,
 *   because "on" means two genuinely different algorithms:
 *   - `'highQuality'` (the basemap): a custom chain from `buildHighQualityMipmaps`, not
 *     `WebGLRenderer`'s implicit `gl.generateMipmap()` — see that function for the Moiré artefact
 *     a naive box filter produces on this texture's sRGB-encoded photographic detail.
 *   - `'boxFilter'` (the density overlay): the built-in `gl.generateMipmap()` box filter,
 *     deliberately *not* routed through `buildHighQualityMipmaps`. Its texels are `NoColorSpace`
 *     numeric fractions, not gamma-encoded colour, so an arithmetic mean of raw bytes *is* the
 *     correct area average — the same property that makes a box filter wrong for the basemap's
 *     sRGB bytes, since averaging gamma-encoded values is not averaging the light they encode.
 *     Routing numeric data through the canvas-based chain would swap a spec-guaranteed raw-byte
 *     average for a browser-dependent `drawImage` resampler whose gamma handling for a non-colour
 *     "image" is unspecified.
 * - **`colorSpace`.** The basemap is a colour image (sRGB, like PaleoDEM). The density texture is
 *   not: its channels are fractions, and decoding them through an sRGB curve (three.js's default)
 *   corrupts the values before the fragment shader reads them, so its instance uses
 *   `THREE.NoColorSpace`. Any future numeric overlay needs the same.
 *
 * `ImageBitmap.close()` must never be scheduled by a frame count. Closing it a few
 * `requestAnimationFrame` ticks after texture creation, on the assumption three.js has uploaded
 * it by then, is a real race: `WebGL: INVALID_VALUE: texSubImage2D: The source data has been
 * detached` fires on the first expand with a cold cache and leaves the texture permanently blank,
 * because three.js will not retry an upload once `needsUpdate` has been consumed.
 * `initAndCloseHumanEraTexture` instead calls `WebGLRenderer.initTexture`, which forces the
 * upload synchronously, making an immediate close provably safe. `Globe.tsx`'s `GlobeSphere` —
 * the one place with `useThree()` access to the renderer — calls it once per texture.
 */

import * as THREE from 'three'

import { ByteCappedCache } from './byteCappedCache'

export interface HumanEraTextureCache {
  loadTexture(url: string): Promise<THREE.Texture>
  /** `options.aggressive` is accepted to match `useGlobeTexturePair`'s `GlobeTextureCache` shape
   *  but has no extra effect: `ByteCappedCache` already evicts to its byte budget on every trim.
   *  The aggressive/evict-below-capacity need is specific to the PaleoDEM LRU, which can sit well
   *  under its capacity while still holding frames nothing on screen needs. */
  trimTextures(keep: ReadonlySet<string>, options?: { aggressive?: boolean }): void
  /** Evicts and disposes every cached texture unconditionally. Unlike PaleoDEM's cache, these
   *  textures have their backing `ImageBitmap` force-uploaded and closed as soon as they bind
   *  (`initAndCloseHumanEraTexture`), so a WebGL context loss leaves them unrecoverable:
   *  three.js's automatic re-upload from `texture.image` on `webglcontextrestored` needs a live
   *  image, and a closed `ImageBitmap` is not one. `Globe.tsx`'s `GlobeSphere` calls this on
   *  `webglcontextrestored` (with `useGlobeTexturePair`'s `resetKey` forcing a re-fetch), trading
   *  a network fetch for a texture that would otherwise stay blank forever. */
  clear(): void
}

/** Forces `texture`'s GPU upload synchronously (`WebGLRenderer.initTexture`), then closes its
 *  backing `ImageBitmap` if it has one. Safe to call on every texture this cache hands out (a
 *  `DataTexture` has no `ImageBitmap`, so the close is skipped) and safe to call repeatedly
 *  (closing a closed `ImageBitmap` is a no-op). Exported so `Globe.tsx` — the one place with
 *  `useThree()` access to a renderer — can call it once it has both a texture and a renderer. */
export function initAndCloseHumanEraTexture(renderer: THREE.WebGLRenderer, texture: THREE.Texture): void {
  renderer.initTexture(texture)
  const image: unknown = texture.image
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close()
}

/** The `[width, height]` of every level in a full mip chain down to 1x1, starting with
 *  `[baseWidth, baseHeight]` itself at index 0 — pure (no canvas/DOM dependency), so the one part
 *  of `buildHighQualityMipmaps` worth pinning with a unit test (getting the halving/rounding or
 *  the stopping condition wrong would silently under- or over-build the chain) can be, without a
 *  browser canvas context. Halves each axis independently, flooring and clamping to a minimum of
 *  1 — the same non-square-aspect-safe convention a GPU's own mip chain follows. */
export function mipmapDimensions(baseWidth: number, baseHeight: number): [number, number][] {
  const dimensions: [number, number][] = [[baseWidth, baseHeight]]
  let width = baseWidth
  let height = baseHeight
  while (width > 1 || height > 1) {
    width = Math.max(1, Math.floor(width / 2))
    height = Math.max(1, Math.floor(height / 2))
    dimensions.push([width, height])
  }
  return dimensions
}

/** Resizes `source` to `width`x`height` on an offscreen 2D canvas, with the browser's own
 *  highest-quality image resampling (`imageSmoothingQuality: 'high'`) — a proper area-averaging/
 *  Lanczos-ish filter, not the single naive box-filter step `WebGLRenderer`'s own
 *  `gl.generateMipmap()` applies at every level of the chain. */
function drawResizedCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new Error('humanEraTextureCache: 2D canvas context unavailable for mipmap generation')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  return canvas
}

/**
 * A full mip chain for `bitmap`, built with `drawResizedCanvas` rather than left to
 * `WebGLRenderer`'s implicit `gl.generateMipmap()`. Natural Earth II's basemap carries fine,
 * near-periodic bathymetric shaded-relief striations across open ocean, and a plain box-filter
 * chain aliases that correlated detail into smooth, wavy closed loops at the coarser mip levels
 * sampled once the globe is minified — a Moiré pattern present at no single resolution of the
 * source image, only in the GPU's naive downsampling of it.
 *
 * Every level is resized from the *original* `bitmap`, never progressively from the previous
 * level, since chaining compounds each step's resampling error and reintroduces the aliasing this
 * exists to avoid. Level 0 is a full-resolution drawn copy rather than `bitmap` itself because
 * `@types/three`'s `Texture.mipmaps` is an `HTMLCanvasElement[]` (no `ImageBitmap` option) and
 * `WebGLTextures.uploadTexture` takes level 0 *from that array* once it is non-empty, not from
 * `texture.image` — at the cost of one extra full-resolution canvas, alive only until
 * `initAndCloseHumanEraTexture` forces the upload. The caller's `texture.generateMipmaps = false`
 * is what makes `WebGLTextures` skip `gl.generateMipmap()` and upload these levels as given.
 */
function buildHighQualityMipmaps(bitmap: ImageBitmap): HTMLCanvasElement[] {
  return mipmapDimensions(bitmap.width, bitmap.height).map(([width, height]) => drawResizedCanvas(bitmap, width, height))
}

/**
 * How a cache instance builds (or skips) its mip chain — see the module doc for why "on" is not a
 * single algorithm. A closed union rather than a boolean, so a caller cannot silently route a
 * numeric-fraction texture through the colour-tuned resampler or vice versa.
 */
export type MipmapStrategy =
  | 'none'
  /** `buildHighQualityMipmaps`'s own canvas-resampled chain — for sRGB colour imagery only. */
  | 'highQuality'
  /** The plain built-in `gl.generateMipmap()` box filter — correct for `NoColorSpace` numeric
   *  fraction data, where averaging raw byte values *is* averaging the underlying quantity. */
  | 'boxFilter'

function textureByteSize(texture: THREE.Texture, mipmapStrategy: MipmapStrategy): number {
  const image = texture.image as { width?: number; height?: number } | undefined
  const width = image?.width ?? 0
  const height = image?.height ?? 0
  // RGBA8: 4 bytes/texel. Mipmaps add the usual geometric-series overhead, ~4/3 of the base
  // level (1 + 1/4 + 1/16 + ... -> 4/3), the same regardless of which strategy built the chain.
  const base = width * height * 4
  return mipmapStrategy === 'none' ? base : Math.ceil(base * (4 / 3))
}

export interface CreateHumanEraTextureCacheOptions {
  /** Total decoded bytes this cache may hold before `trimTextures` starts evicting. */
  byteCapacity: number
  colorSpace: THREE.ColorSpace
  mipmapStrategy: MipmapStrategy
  /** Passed straight through to `createImageBitmap`. The browser's decode defaults are right for
   *  the basemap's `SRGBColorSpace` colour imagery. The density cache overrides both to `'none'`:
   *  its channels are fractions, not colour, and the default colour-space conversion or
   *  browser-chosen alpha premultiplication would corrupt them during *decode* — before
   *  `texture.colorSpace = NoColorSpace` can matter, since that only governs how the GPU
   *  interprets already-decoded texels. */
  createImageBitmapOptions?: ImageBitmapOptions
}

/** Builds one independent cache instance — call once per layer (basemap, density), not once per
 *  component render; each instance owns its own in-flight map and eviction state, the same
 *  module-singleton shape `textureCache.ts` uses for PaleoDEM. */
export function createHumanEraTextureCache(options: CreateHumanEraTextureCacheOptions): HumanEraTextureCache {
  const { byteCapacity, colorSpace, mipmapStrategy, createImageBitmapOptions = {} } = options

  function disposeTexture(texture: THREE.Texture): void {
    texture.dispose()
    const image: unknown = texture.image
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close()
  }

  const cache = new ByteCappedCache<THREE.Texture>(byteCapacity, disposeTexture, (t) => textureByteSize(t, mipmapStrategy))
  const inFlight = new Map<string, Promise<THREE.Texture>>()

  async function fetchTexture(url: string): Promise<THREE.Texture> {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`failed to load human-era globe texture ${url}: HTTP ${response.status}`)
    const bitmap = await createImageBitmap(await response.blob(), createImageBitmapOptions)
    const texture = new THREE.Texture(bitmap)
    texture.colorSpace = colorSpace
    texture.minFilter = mipmapStrategy === 'none' ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    switch (mipmapStrategy) {
      case 'highQuality':
        // Own mip chain, not WebGLRenderer's implicit gl.generateMipmap() — see
        // buildHighQualityMipmaps's own doc comment for the Moiré artefact this fixes.
        texture.mipmaps = buildHighQualityMipmaps(bitmap)
        texture.generateMipmaps = false
        break
      case 'boxFilter':
        // Leave `texture.mipmaps` empty and let WebGLTextures's normal upload path call the
        // renderer's own `gl.generateMipmap()` — this module's top doc comment on why a plain
        // box filter, not the canvas-based chain above, is the right (and simpler) choice for
        // NoColorSpace fraction data.
        texture.generateMipmaps = true
        break
      case 'none':
        texture.generateMipmaps = false
        break
    }
    // Matches textureCache.ts's own convention exactly (see its doc comment): an ImageBitmap
    // uploads unflipped, and the fragment shader's uv formula assumes v=0 samples the source
    // image's top row (north).
    texture.flipY = false
    texture.needsUpdate = true
    return texture
  }

  function loadTexture(url: string): Promise<THREE.Texture> {
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

  function trimTextures(keep: ReadonlySet<string>): void {
    cache.trim(keep)
  }

  function clear(): void {
    cache.clear()
  }

  return { loadTexture, trimTextures, clear }
}

/** The Natural Earth II basemap cache (ADR-030): sRGB colour, mipmapped (this module's
 *  doc comment — the tiers alias badly at globe scale without mipmaps). Sized for one T1 frame
 *  plus mip overhead (~43 MB) with headroom for a T0 frame held during a tier switch, well
 *  inside the desktop-expanded memory budget. */
export const basemapTextureCache: HumanEraTextureCache = createHumanEraTextureCache({
  byteCapacity: 70 * 1024 * 1024,
  colorSpace: THREE.SRGBColorSpace,
  mipmapStrategy: 'highQuality',
})

/**
 * The population-density cache (ADR-031 amendment) — the numeric-overlay consumer this module's
 * own doc comment anticipated, and the exact case every `NoColorSpace`/`'boxFilter'` paragraph
 * above was written for: its R channel is a log-encoded people/km² *value*, not colour, so an
 * sRGB decode (at load or on sampling) would corrupt it before the shader ever read it, and a
 * plain box-filter mip chain — the arithmetic mean of raw bytes — is the right filter for it
 * where the canvas resampler the basemap needs would be wrong.
 *
 * 1024×512 RGBA frames are ~2 MB each, ~2.8 MB with mips: this holds roughly eight, which
 * comfortably covers the bracketing pair plus the scrub-around headroom `useGlobeTexturePair`'s
 * own trim keeps.
 */
export const densityTextureCache: HumanEraTextureCache = createHumanEraTextureCache({
  byteCapacity: 24 * 1024 * 1024,
  colorSpace: THREE.NoColorSpace,
  mipmapStrategy: 'boxFilter',
  createImageBitmapOptions: { colorSpaceConversion: 'none', premultiplyAlpha: 'none' },
})
