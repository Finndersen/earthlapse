/**
 * A second, byte-capped texture cache (`ByteCappedCache`), separate from the PaleoDEM LRU
 * (`textureCache.ts`), for human-era globe layers whose texture is much higher resolution than
 * PaleoDEM's, or is numeric data rather than colour: today, the Natural Earth II basemap
 * (`sources/basemap`, ADR-030) and the HYDE population-density overlay (`densityTextureCache`
 * below, ADR-031 amendment), which is this cache's `'boxFilter'`/`NoColorSpace` consumer. The
 * cleared-land overlay ADR-031 originally shipped was this cache's second consumer and was
 * removed from the web app (kept in the data pipeline only) — it is kept below as the worked
 * example that motivated the two strategies, since the density overlay needs exactly the same
 * treatment for exactly the same reasons.
 *
 * Two things the PaleoDEM cache deliberately does *not* do, both needed here:
 *
 * - **Mipmaps.** PaleoDEM's 1024x512 frames are close to their on-screen size at every zoom
 *   this project ships (`textureCache.ts`'s own doc comment), so `generateMipmaps: false` is
 *   fine there. The basemap tiers are much higher resolution (2048x1024 / 4096x2048) mapped
 *   onto the same small sphere — without mipmaps they alias badly. HYDE's texture was the *same*
 *   1024x512 size as PaleoDEM, but unlike PaleoDEM's smoothly-varying elevation, it could change
 *   sharply from one texel to the next (a HYDE gridcell's cropland/pasture/rangeland split could
 *   flip hard across a climate or land-use boundary — the Sahel/Sahara fringe was the worst case,
 *   confirmed by direct pixel inspection: adjacent texels alternating between near-0 and near-
 *   255 in the cropland and rangeland channels within a one-degree box) — mipmaps matter for that
 *   kind of texture too, just for a different reason (aliasing a spatially sharp *signal*, not
 *   photographic detail) — a future numeric overlay should expect the same. `createHumanEraTextureCache`
 *   takes a `mipmapStrategy` per cache instance rather than a bare `generateMipmaps: boolean`,
 *   because "on" means two genuinely different algorithms depending on what the texture holds:
 *   - `'highQuality'` (the basemap): a custom chain built by `buildHighQualityMipmaps` below,
 *     not left to `WebGLRenderer`'s own implicit `gl.generateMipmap()` — see that function's own
 *     doc comment for the Moiré artefact (fine ocean bathymetric striations aliasing into smooth
 *     false "contour loops" at coarser mip levels) a naive box-filter chain produces on this
 *     texture's sRGB-encoded photographic detail.
 *   - `'boxFilter'` (HYDE, formerly): the plain built-in `gl.generateMipmap()` box filter,
 *     deliberately *not* routed through `buildHighQualityMipmaps`. HYDE's texels were
 *     `NoColorSpace` numeric fractions, not gamma-encoded colour — a plain box filter (arithmetic
 *     mean of raw byte values) *is* the mathematically correct area average for that kind of data,
 *     which is exactly the property that makes the same box filter *wrong* for the basemap's sRGB
 *     bytes (averaging gamma-encoded values isn't the same as averaging the light they encode).
 *     Routing a numeric-fraction texture through the canvas-based `'highQuality'` chain instead
 *     would trade a well-understood, spec-guaranteed raw-byte average for a browser-dependent
 *     `drawImage` resampler whose gamma handling for a non-colour "image" is unspecified — worse,
 *     not better, for this kind of data. Originally HYDE's own cache had no mip chain at all
 *     ("already coarse, used as a soft tint, not worth the memory") — that reasoning held for a
 *     *smoothly* varying fraction field, but not for the sharp Sahel-style boundaries above:
 *     without mipmapping, minifying the globe (orb size especially) makes the GPU bilinear-sample
 *     only the 2x2 texels nearest each screen pixel's UV, aliasing that sharp checkerboard into a
 *     scattering of full-strength hits across an area whose true averaged fraction is tiny —
 *     browser-verified (Playwright) as a real "saturated yellow band" across the Sahel at orb size
 *     that a `'boxFilter'` mip chain removed.
 * - **`colorSpace`.** The basemap is a photographic/cartographic colour image (sRGB, like
 *   PaleoDEM). HYDE's texture was *not* a colour image — its R/G channels were cropland/grazing
 *   *fractions*, and decoding them through an sRGB curve (three.js's default for a sampled
 *   texture read in the shader) would have corrupted the values before the fragment shader ever
 *   read them. A future numeric overlay's cache instance should use `THREE.NoColorSpace` for the
 *   same reason, the way HYDE's own (now-removed) instance did.
 *
 * `ImageBitmap.close()`: **not** scheduled by a fixed frame count. An
 * earlier version of this module closed the bitmap a couple of `requestAnimationFrame` ticks
 * after texture creation, guessing that three.js would have uploaded it to the GPU by then —
 * browser-verified (Playwright, a fresh page/context) to be a genuine race, not just a
 * theoretical one: `WebGL: INVALID_VALUE: texSubImage2D: The source data has been detached`
 * fired on the very first expand on a cold cache, because the upload hadn't actually happened
 * yet when the bitmap was closed, leaving the texture permanently blank (three.js has no reason
 * to retry an upload once `needsUpdate` has already been consumed). `initAndCloseHumanEraTexture`
 * below is the fix: it calls `WebGLRenderer.initTexture`, which forces the GPU upload
 * *synchronously* (three.js's own docs: "useful for preloading a texture rather than waiting
 * until first render"), so closing the bitmap immediately after is provably safe rather than a
 * best-effort guess. `Globe.tsx`'s `GlobeSphere` — the one place with `useThree()` access to the
 * renderer — calls it exactly once per texture, the first time it receives one as a prop.
 */

import * as THREE from 'three'

import { ByteCappedCache } from './byteCappedCache'

export interface HumanEraTextureCache {
  loadTexture(url: string): Promise<THREE.Texture>
  /** `options.aggressive` is accepted (matching `useGlobeTexturePair`'s `GlobeTextureCache`
   *  shape) but has no extra effect here: `ByteCappedCache` already evicts down to its own
   *  byte budget on every trim, and this cache never holds more than a handful of small
   *  frames — the "aggressive, evict-below-capacity" need `lru.ts`'s doc comment describes is
   *  specific to the PaleoDEM LRU, which (unlike a byte cap) can otherwise sit well under its
   *  20-ish-MB capacity while still holding frames nothing on screen needs. */
  trimTextures(keep: ReadonlySet<string>, options?: { aggressive?: boolean }): void
  /** Evicts and disposes every cached texture unconditionally. This
   *  cache's own textures — unlike `textureCache.ts`'s PaleoDEM cache — have their backing
   *  `ImageBitmap` force-uploaded and closed the moment they're bound
   *  (`initAndCloseHumanEraTexture` above), so a WebGL context loss leaves them permanently
   *  unrecoverable: three.js's own automatic re-upload-from-`texture.image` on
   *  `webglcontextrestored` needs a live image to read from, and a closed `ImageBitmap` isn't
   *  one. `Globe.tsx`'s `GlobeSphere` calls this (and `useGlobeTexturePair`'s `resetKey` option
   *  forces the owning pair to re-fetch) on `webglcontextrestored`, trading a fresh network
   *  fetch for a texture that would otherwise stay blank forever. */
  clear(): void
}

/** Forces `texture`'s GPU upload synchronously (`WebGLRenderer.initTexture`), then closes its
 *  backing `ImageBitmap` if it has one — safe to call unconditionally on every texture this
 *  cache hands out (a `PLACEHOLDER_TEXTURE`-style `DataTexture` has no `ImageBitmap` image, so
 *  the close is simply skipped for it), and safe to call more than once on the same texture (a
 *  closed `ImageBitmap`'s own `close()` is a no-op). Exported so `Globe.tsx` (the one place with
 *  `useThree()` access to a `WebGLRenderer`, since this module is plain, renderer-agnostic
 *  application code) can call it the moment it actually has both a texture and a renderer. */
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
 * `WebGLRenderer`'s own implicit `gl.generateMipmap()` — real, browser-verified bug this fixes:
 * Natural Earth II's basemap has fine, near-periodic bathymetric shaded-relief striations across
 * open ocean, and a plain box-filter mip chain (`gl.generateMipmap()`'s own algorithm, applied
 * once per halving) aliases that fine, correlated detail into smooth, wavy, meandering closed
 * loops at the coarser mip levels actually sampled once the globe is minified to its on-screen
 * size — a Moiré pattern that exists at *no* single resolution of the source image itself, only
 * in the GPU's own naive downsampling of it. Confirmed two ways: forcing the fragment shader's
 * `baseColor` to a flat constant made the loops vanish (so they come from texture sampling, not
 * lighting/geometry/an active regime overlay); disabling mipmaps entirely (`LinearFilter`, no
 * chain) *also* made them vanish while the base texture still rendered correctly (so they are
 * specifically a mip-generation artifact, not present in the base level).
 *
 * Every level is resized directly from the *original* `bitmap`, not progressively from the
 * previous (smaller) level — chaining would compound each step's own resampling error, softening
 * detail and (worse) reintroducing exactly the kind of aliasing this exists to avoid. Level 0 is
 * still a full-resolution copy of `bitmap` (drawn, not resized) rather than `bitmap` itself:
 * `@types/three`'s own `Texture.mipmaps` type is a plain `HTMLCanvasElement[]` (among a few
 * other single-type array options, none of which include `ImageBitmap`), and `WebGLTextures`'s
 * own "regular Texture" upload path (`uploadTexture`) uploads level 0 *from this array* once it
 * is non-empty, not from `texture.image` separately — so a uniform `HTMLCanvasElement[]` is
 * simplest, at the cost of one extra full-resolution canvas alive only until
 * `initAndCloseHumanEraTexture`'s forced upload completes. `texture.generateMipmaps = false`
 * (set by the caller) is what makes `WebGLTextures` skip `gl.generateMipmap()` entirely and
 * upload each of these levels exactly as given via `texImage2D`.
 */
function buildHighQualityMipmaps(bitmap: ImageBitmap): HTMLCanvasElement[] {
  return mipmapDimensions(bitmap.width, bitmap.height).map(([width, height]) => drawResizedCanvas(bitmap, width, height))
}

/**
 * How a cache instance builds (or skips) its mip chain — see this module's own top doc comment
 * for why "on" isn't a single algorithm. A plain `boolean` would force every caller to also know
 * *which* algorithm "true" secretly means for its own texture's data, and would make it silently
 * easy to route a numeric-fraction texture through the colour-tuned resampler (or vice versa) —
 * this closed union makes the choice explicit at each call site instead.
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
  /** Passed straight through to `createImageBitmap`. Defaults to the browser's
   *  own decode defaults — right for the basemap's `SRGBColorSpace` (a real photographic/
   *  cartographic image, where those defaults are exactly what a colour image wants). HYDE's
   *  cache instance below overrides both to `'none'`: its R/G channels are cropland/pasture
   *  *fractions*, not colour (this module's own top doc comment on `NoColorSpace`), and letting
   *  `createImageBitmap` apply its default colour-space conversion or (browser-chosen)
   *  alpha premultiplication would corrupt those values during *decode*, before `texture.
   *  colorSpace = NoColorSpace` ever gets a chance to matter — that setting only affects how the
   *  GPU interprets already-decoded texels, not the decode step itself. */
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
