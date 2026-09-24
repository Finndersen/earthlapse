/**
 * Rasterises the active empire snapshots (ADR-059) into an equirectangular texture the globe
 * shader composites after the overlay mix, and fetches the territory geometry they are drawn
 * from.
 *
 * The cache implements `useGlobeTexturePair`'s `GlobeTextureCache`, so the empire pair gets the
 * same "keep the old pair bound until the new one is ready" discipline as every other globe
 * texture. Its "url" is a texture key (`empireTextureKey`): the active set's frame key, the tier
 * and whether the fill is on. `loadTexture` paints instead of fetching.
 *
 * Painting: one `Path2D` per lineage holding every member's rings, wound so the nonzero rule
 * unions overlapping members and still cuts holes (`orientedRingPixels`); fills first, then every
 * casing, then every coloured stroke, so no lineage's fill covers another's outline. The canvas
 * is copied into a premultiplied `ImageBitmap`, which `Globe.tsx` force-uploads and closes like
 * the other human-era textures (`initAndCloseHumanEraTexture`). Premultiplied texels keep the
 * mip chain free of dark fringes; the bytes stay sRGB-encoded (`NoColorSpace`) and the shader
 * un-premultiplies before decoding, since decoding sRGB on premultiplied values would darken
 * every partially transparent texel. Losing the WebGL context loses the uploads, so
 * `Globe.tsx` clears this cache and repaints on restore.
 */

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import { parseTerritoryGeometry, type TerritoryGeometry } from '@/data/curated'

import { ByteCappedCache } from './byteCappedCache'
import { EMPIRE_CASING_COLOUR, EMPIRE_FILL_ALPHA, EMPIRE_TIERS, empireColour, type EmpireTier } from './empireStyle'
import { orientedRingPixels, ringStrokeRuns, type EmpireIndex, type EmpireSnapshot } from './empires'
import type { GlobeTextureCache } from './useGlobeTexturePair'

let maxAnisotropy = 1

export function setEmpireMaxAnisotropy(value: number): void {
  maxAnisotropy = value
}

/** Two expandedHigh textures with mips (~43 MB each) — the bound pair during a crossfade. */
const EMPIRE_CACHE_BYTES = 96 * 1024 * 1024

export function empireTextureKey(frameKey: string, tier: EmpireTier, fill: boolean): string {
  return `${frameKey}|${tier}|${fill ? 'fill' : 'line'}`
}

function parseEmpireTextureKey(key: string): { frameKey: string; tier: EmpireTier; fill: boolean } {
  const [fillPart, tierPart, ...rest] = key.split('|').reverse()
  const tier = tierPart as EmpireTier
  if (!(tier in EMPIRE_TIERS) || (fillPart !== 'fill' && fillPart !== 'line')) {
    throw new Error(`empire texture key ${key} is malformed`)
  }
  return { frameKey: rest.reverse().join('|'), tier, fill: fillPart === 'fill' }
}

export interface EmpireTextureCache extends GlobeTextureCache {
  clear(): void
}

const scratchCanvases = new Map<string, HTMLCanvasElement | OffscreenCanvas>()

function scratchContext(width: number, height: number): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
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
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null
  if (ctx === null) throw new Error('empireTexture: 2D canvas context unavailable')
  return ctx
}

function tracePolyline(path: Path2D, xy: readonly number[], closed: boolean): void {
  path.moveTo(xy[0]!, xy[1]!)
  for (let i = 2; i < xy.length; i += 2) path.lineTo(xy[i]!, xy[i + 1]!)
  if (closed) path.closePath()
}

function paintSnapshots(
  snapshots: readonly EmpireSnapshot[],
  geometry: TerritoryGeometry,
  tier: EmpireTier,
  fill: boolean,
): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  const { width, height, stroke, casing } = EMPIRE_TIERS[tier]
  const ctx = scratchContext(width, height)
  ctx.clearRect(0, 0, width, height)

  const fills = new Map<string, { path: Path2D; colour: string }>()
  const outlines: { path: Path2D; colour: string }[] = []
  for (const snapshot of snapshots) {
    const polygons = geometry.snapshots.get(snapshot.id)
    if (polygons === undefined) continue
    const colour = empireColour(snapshot.colourSlot)
    let lineageFill = fills.get(snapshot.lineage)
    if (lineageFill === undefined) {
      lineageFill = { path: new Path2D(), colour }
      fills.set(snapshot.lineage, lineageFill)
    }
    const outline = new Path2D()
    for (const polygon of polygons) {
      polygon.forEach((ring, r) => {
        tracePolyline(lineageFill.path, orientedRingPixels(ring, width, height, r === 0), true)
        const { runs, closed } = ringStrokeRuns(ring, width, height)
        for (const run of runs) tracePolyline(outline, run, closed)
      })
    }
    outlines.push({ path: outline, colour })
  }

  if (fill) {
    ctx.globalAlpha = EMPIRE_FILL_ALPHA
    for (const { path, colour } of fills.values()) {
      ctx.fillStyle = colour
      ctx.fill(path, 'nonzero')
    }
    ctx.globalAlpha = 1
  }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = EMPIRE_CASING_COLOUR
  ctx.lineWidth = casing
  for (const { path } of outlines) ctx.stroke(path)
  ctx.lineWidth = stroke
  for (const { path, colour } of outlines) {
    ctx.strokeStyle = colour
    ctx.stroke(path)
  }
  return ctx
}

function textureBytes(texture: THREE.Texture): number {
  const image = texture.image as { width?: number; height?: number } | undefined
  return Math.ceil((image?.width ?? 0) * (image?.height ?? 0) * 4 * (4 / 3))
}

function disposeTexture(texture: THREE.Texture): void {
  texture.dispose()
  const image: unknown = texture.image
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close()
}

/** An empty active set: a 1x1 transparent texture rather than a full-size blank canvas. */
function transparentTexture(): THREE.Texture {
  const texture = new THREE.DataTexture(new Uint8Array(4), 1, 1)
  texture.needsUpdate = true
  return texture
}

async function rasterise(key: string, index: EmpireIndex, geometry: TerritoryGeometry): Promise<THREE.Texture> {
  const { frameKey, tier, fill } = parseEmpireTextureKey(key)
  const frame = index.frameByKey.get(frameKey)
  if (frame === undefined) throw new Error(`empire texture key ${key} names no active set`)
  if (frame.snapshots.length === 0) return transparentTexture()

  const ctx = paintSnapshots(frame.snapshots, geometry, tier, fill)
  // `createImageBitmap` snapshots the canvas synchronously, so the shared scratch canvas is free
  // for the next paint as soon as this call returns.
  const bitmap = await createImageBitmap(ctx.canvas, { premultiplyAlpha: 'premultiply', colorSpaceConversion: 'none' })
  const texture = new THREE.Texture(bitmap)
  texture.colorSpace = THREE.NoColorSpace
  texture.premultiplyAlpha = true
  texture.flipY = false
  texture.wrapS = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = maxAnisotropy
  texture.needsUpdate = true
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
    const promise = rasterise(key, index, geometry).then(
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
    trimTextures: (keep) => cache.trim(keep),
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
