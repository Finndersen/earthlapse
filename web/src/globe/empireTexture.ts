/**
 * Rasterises the active empire snapshots (ADR-059) into a coverage texture the globe shader
 * turns into fills and borders, and fetches the territory geometry they are drawn from.
 *
 * The cache implements `useGlobeTexturePair`'s `GlobeTextureCache`, so the empire pair gets the
 * same "keep the old pair bound until the new one is ready" discipline as every other globe
 * texture. Its "url" is a texture key (`empireTextureKey`): the active set's frame key, the tier,
 * whether the fill is on and the highlighted lineage. `loadTexture` paints instead of fetching.
 * While one texture is kept (no crossfade or rebind in flight), trimming keeps its unhighlighted
 * twin resident too, so hovering on and off an empire swaps between two cached textures instead
 * of repainting.
 *
 * **Coverage, not strokes.** Borders are not painted: the shader draws each one in screen space
 * on the half-way contour of a coverage channel, so it stays about one CSS pixel wide at any zoom.
 * The texture is three equirectangular bands stacked vertically (`EMPIRE_BANDS`), each a
 * `EMPIRE_TIERS` grid. Channel `c` lives in band `floor(c / 3)`, colour channel `c % 3`: channels
 * 0–7 are the coverage of each palette slot (every lineage of that `colourSlot`, one nonzero
 * `Path2D` over rings wound by `orientedRingPixels`, so overlapping members union and holes cut),
 * and channel 8 is the highlighted lineage's own coverage. A slot is a sound border identity
 * because the roster never gives two coexisting neighbours the same slot. Each band's alpha is a
 * constant the shader reads at the band's centre: band 0 whether the fill is on, band 1 the
 * highlighted lineage's slot (`EMPIRE_SLOT_CODE_STEP`), band 2 the device pixel ratio at paint
 * time (`EMPIRE_PIXEL_RATIO_CODE`), so the texture alone says how to draw itself and a crossfade
 * between two of them needs no extra state. `RepeatWrapping` joins the two sides of the
 * antimeridian, where Cliopatria cuts its polygons; the shader draws no line along the cut.
 *
 * The bands are drawn opaque (black, then each channel added with `lighter`) so every channel
 * stays independent, read back once, their alphas set, and uploaded as a mipmapped
 * `NoColorSpace` `DataTexture`; the CPU copy is dropped after the upload. Losing the WebGL
 * context loses the uploads, so `Globe.tsx` clears this cache and repaints on restore.
 */

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import { parseTerritoryGeometry, type TerritoryGeometry } from '@/data/curated'

import { ByteCappedCache } from './byteCappedCache'
import { EMPIRE_PALETTE, EMPIRE_TIERS, type EmpireTier } from './empireStyle'
import { orientedRingPixels, type EmpireIndex, type EmpireSnapshot } from './empires'
import type { GlobeTextureCache } from './useGlobeTexturePair'

let maxAnisotropy = 1

export function setEmpireMaxAnisotropy(value: number): void {
  maxAnisotropy = value
}

/** Bands stacked in one texture: eight slot channels and the highlight channel, three per band. */
export const EMPIRE_BANDS = 3
/** The channel holding the highlighted lineage's coverage. */
const HIGHLIGHT_CHANNEL = EMPIRE_PALETTE.length
/** Band 1's alpha byte is `(slot + 1) * EMPIRE_SLOT_CODE_STEP` for the highlighted slot, 0 for none;
 *  the step is wide so the shader's rounding never lands on a neighbouring slot. */
export const EMPIRE_SLOT_CODE_STEP = 28
/** Band 2's alpha byte is the device pixel ratio times this (a ratio up to ~4 fits a byte). */
export const EMPIRE_PIXEL_RATIO_CODE = 64

/** Two expandedHigh textures with mips (~34 MB each): the bound pair during a crossfade, or a
 *  highlighted texture and its resident unhighlighted twin. A twin is protected only while one
 *  texture is kept, so the two never add up. */
const EMPIRE_CACHE_BYTES = 72 * 1024 * 1024

interface EmpireTextureSpec {
  frameKey: string
  tier: EmpireTier
  fill: boolean
  /** The emphasised lineage, or `null`; pass it through `empireHighlightIn` first so a frame
   *  that does not draw it shares the unhighlighted texture. */
  highlight: string | null
}

export function empireTextureKey({ frameKey, tier, fill, highlight }: EmpireTextureSpec): string {
  return `${frameKey}|${tier}|${fill ? 'fill' : 'line'}|${highlight ?? ''}`
}

function parseEmpireTextureKey(key: string): EmpireTextureSpec {
  const [highlightPart, fillPart, tierPart, ...rest] = key.split('|').reverse()
  const tier = tierPart as EmpireTier
  if (highlightPart === undefined || !(tier in EMPIRE_TIERS) || (fillPart !== 'fill' && fillPart !== 'line')) {
    throw new Error(`empire texture key ${key} is malformed`)
  }
  return { frameKey: rest.reverse().join('|'), tier, fill: fillPart === 'fill', highlight: highlightPart === '' ? null : highlightPart }
}

export interface EmpireTextureCache extends GlobeTextureCache {
  clear(): void
}

type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

const scratchCanvases = new Map<string, HTMLCanvasElement | OffscreenCanvas>()

function scratchContext(width: number, height: number): Context2D {
  const sizeKey = `${width}x${height}`
  let canvas = scratchCanvases.get(sizeKey)
  if (canvas === undefined) {
    if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(width, height)
    } else {
      canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
    }
    scratchCanvases.set(sizeKey, canvas)
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Context2D | null
  if (ctx === null) throw new Error('empireTexture: 2D canvas context unavailable')
  return ctx
}

function tracePolyline(path: Path2D, xy: readonly number[]): void {
  path.moveTo(xy[0]!, xy[1]!)
  for (let i = 2; i < xy.length; i += 2) path.lineTo(xy[i]!, xy[i + 1]!)
  path.closePath()
}

const CHANNEL_COLOURS = ['#ff0000', '#00ff00', '#0000ff'] as const

function devicePixelRatioNow(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

/** The stacked coverage bands for `snapshots`, alphas set, as RGBA bytes (layout: module doc). */
function paintCoverage(snapshots: readonly EmpireSnapshot[], geometry: TerritoryGeometry, { tier, fill, highlight }: EmpireTextureSpec): Uint8Array {
  const { width, height } = EMPIRE_TIERS[tier]
  const ctx = scratchContext(width, height * EMPIRE_BANDS)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, height * EMPIRE_BANDS)

  const channels = new Map<number, Path2D>()
  let highlightSlot = -1
  for (const snapshot of snapshots) {
    const polygons = geometry.snapshots.get(snapshot.id)
    if (polygons === undefined) continue
    const highlighted = snapshot.lineage === highlight
    if (highlighted) highlightSlot = snapshot.colourSlot
    const targets = highlighted ? [snapshot.colourSlot, HIGHLIGHT_CHANNEL] : [snapshot.colourSlot]
    for (const polygon of polygons) {
      polygon.forEach((ring, r) => {
        const xy = orientedRingPixels(ring, width, height, r === 0)
        for (const channel of targets) {
          let path = channels.get(channel)
          if (path === undefined) {
            path = new Path2D()
            channels.set(channel, path)
          }
          tracePolyline(path, xy)
        }
      })
    }
  }

  ctx.globalCompositeOperation = 'lighter'
  for (const [channel, path] of channels) {
    ctx.setTransform(1, 0, 0, 1, 0, Math.floor(channel / 3) * height)
    ctx.fillStyle = CHANNEL_COLOURS[channel % 3]!
    ctx.fill(path, 'nonzero')
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'source-over'

  const bytes = new Uint8Array(ctx.getImageData(0, 0, width, height * EMPIRE_BANDS).data.buffer)
  const bandAlpha = [
    fill ? 255 : 0,
    (highlightSlot + 1) * EMPIRE_SLOT_CODE_STEP,
    Math.min(255, Math.round(devicePixelRatioNow() * EMPIRE_PIXEL_RATIO_CODE)),
  ]
  const bandBytes = width * height * 4
  for (let band = 0; band < EMPIRE_BANDS; band++) {
    const alpha = bandAlpha[band]!
    for (let i = band * bandBytes + 3, end = (band + 1) * bandBytes; i < end; i += 4) bytes[i] = alpha
  }
  return bytes
}

function textureBytes(texture: THREE.Texture): number {
  const image = texture.image as { width?: number; height?: number } | undefined
  return Math.ceil((image?.width ?? 0) * (image?.height ?? 0) * 4 * (4 / 3))
}

function disposeTexture(texture: THREE.Texture): void {
  texture.dispose()
}

/** An empty active set: a 1x1 texture with no coverage rather than full-size blank bands. */
function transparentTexture(): THREE.Texture {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1)
  texture.needsUpdate = true
  return texture
}

function rasterise(key: string, index: EmpireIndex, geometry: TerritoryGeometry): THREE.Texture {
  const spec = parseEmpireTextureKey(key)
  const frame = index.frameByKey.get(spec.frameKey)
  if (frame === undefined) throw new Error(`empire texture key ${key} names no active set`)
  if (frame.snapshots.length === 0) return transparentTexture()

  const { width, height } = EMPIRE_TIERS[spec.tier]
  const texture = new THREE.DataTexture(paintCoverage(frame.snapshots, geometry, spec), width, height * EMPIRE_BANDS)
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = maxAnisotropy
  texture.needsUpdate = true
  // Nothing re-uploads a cached texture (a lost context clears the cache), so the bytes are dead
  // weight once on the GPU.
  texture.onUpdate = () => {
    ;(texture.image as { data: Uint8Array | null }).data = null
  }
  return texture
}

/** A cache painting from one `index` and its loaded `geometry`. `Globe.tsx` builds one per
 *  (index, geometry) pair and clears it on unmount and on WebGL context restore. */
export function createEmpireTextureCache(index: EmpireIndex, geometry: TerritoryGeometry): EmpireTextureCache {
  const cache = new ByteCappedCache<THREE.Texture>(EMPIRE_CACHE_BYTES, disposeTexture, textureBytes)
  const inFlight = new Map<string, Promise<THREE.Texture>>()

  function loadTexture(key: string): Promise<THREE.Texture> {
    const cached = cache.get(key)
    if (cached !== undefined) return Promise.resolve(cached)
    const pending = inFlight.get(key)
    if (pending !== undefined) return pending
    const promise = new Promise<THREE.Texture>((resolve) => resolve(rasterise(key, index, geometry))).then(
      (texture) => {
        inFlight.delete(key)
        cache.set(key, texture)
        return texture
      },
      (error: unknown) => {
        inFlight.delete(key)
        throw error
      },
    )
    inFlight.set(key, promise)
    return promise
  }

  return {
    loadTexture,
    trimTextures: (keep) => {
      const resident = new Set(keep)
      if (keep.size === 1) for (const key of keep) resident.add(empireTextureKey({ ...parseEmpireTextureKey(key), highlight: null }))
      cache.trim(resident)
    },
    clear: () => cache.clear(),
  }
}

/**
 * The territory geometry file, fetched once `wanted` first turns true and kept for the session.
 * `null` until it has loaded; a failed fetch or parse is logged and leaves it `null` (the layer
 * then draws nothing) rather than failing the page.
 */
export function useEmpireGeometry(index: EmpireIndex | null, url: string | null, wanted: boolean): TerritoryGeometry | null {
  const [loaded, setLoaded] = useState<{ index: EmpireIndex; geometry: TerritoryGeometry } | null>(null)
  const requestedRef = useRef<EmpireIndex | null>(null)

  useEffect(() => {
    if (!wanted || index === null || url === null || requestedRef.current === index) return
    requestedRef.current = index
    void fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`${url}: fetch failed with status ${res.status}`)
        const geometry = parseTerritoryGeometry(await res.json(), index.data)
        if (requestedRef.current === index) setLoaded({ index, geometry })
      })
      .catch((error: unknown) => console.error(error))
  }, [wanted, index, url])

  return loaded !== null && loaded.index === index ? loaded.geometry : null
}
