'use client'

/**
 * WebGL scene renderer: a full-viewport quad (react-three-fiber) whose fragment shader does the
 * smooth whole-image crossfade (`shaders.ts`, ADR-012), each layer's own focus-centred crop
 * (`framing.ts`, ADR-045, ADR-047) and camera drift (`drift.ts`) in one pass — no stacked DOM layers, no double exposure. Texture loads go through
 * `textureCache`/`useScenePair`, which draw a scene's softened thumbnail until its full image
 * loads (ADR-051) and keep the previously bound pair on screen until both ends have one or the
 * other, so this never shows a blank or black frame; scenes ahead of the current pair are
 * prefetched, decoded and uploaded before they are needed (`prefetch.ts`), and every thumbnail is.
 * `sceneRender.ts`'s `resolveSceneRender`
 * reconciles that bound pair against `mix`/`fromDrift`/`toDrift` (computed for the pair being
 * *requested*, which can outrun what's bound) so the rendered uniforms always describe the
 * bound pair, never a stale texture under a newer pair's drift.
 */

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import * as THREE from 'three'

import { isAbortError } from '@/lib/imagePrefetcher'

import { useSceneCanvasDpr } from './canvasBudget'
import type { DriftUniforms } from './drift'
import { CENTRED_CROP, centreSquareWindow, coverWindow, type CoverWindow, type SceneCrop } from './framing'
import type { PresentationRegime } from './scene'
import { sharpening } from './sceneLayer'
import { resolveSceneRender } from './sceneRender'
import { SCENE_FRAGMENT_SHADER, SCENE_VERTEX_SHADER } from './shaders'
import { sceneImageBytes } from './sceneImageBytes'
import {
  getCachedSceneTexture,
  getCachedSceneThumbnail,
  loadSceneTexture,
  loadSceneThumbnail,
  PLACEHOLDER_TEXTURE,
} from './textureCache'
import { useScenePair, type BoundSceneLayer } from './useScenePair'

/** How long a scene's full image takes to fade in over its own thumbnail under `'crossfade'`. */
export const SHARPEN_SECONDS = 0.4

export interface SceneCanvasViewProps {
  baseUrl: string
  overlayUrl: string
  baseThumbUrl: string
  overlayThumbUrl: string
  /** Scenes to decode and upload ahead of need, most urgent first (`prefetch.ts`). */
  decodeUrls: readonly string[]
  /** Scenes whose bytes to fetch without decoding, most urgent first. */
  fetchUrls: readonly string[]
  thumbUrls: ThumbnailPrefetch
  /** Whether a scene's full image fades in over its thumbnail (`'crossfade'`) or cuts to it. */
  regime: PresentationRegime
  /** Crossfade alpha (`transition.ts`'s `crossfadeAlpha`, already eased) — `0` shows `baseUrl`
   *  alone, `1` shows `overlayUrl` alone, pixel-exact at both ends (see `shaders.ts`). */
  mix: number
  fromDrift: DriftUniforms
  toDrift: DriftUniforms
  /** `from.width / from.height` — assumed shared across scenes (the generation pipeline
   *  renders every shot at the same dimensions, per VISUAL_SPEC's camera grammar). */
  imageAspect: number
  /** Crop of each image URL whose scene has framing; any other URL crops centred. Looked up by
   *  the URL of the texture actually bound, which can lag the requested pair. */
  cropByUrl: ReadonlyMap<string, SceneCrop>
}

/** Thumbnail URLs in two tiers: `near` (the pair's and the prefetch plan's) are fetched with the
 *  pair, `all` (every scene's) behind everything else. */
export interface ThumbnailPrefetch {
  near: readonly string[]
  all: readonly string[]
}

/**
 * Fetches the pair and the near thumbnails, then `decodeUrls`, then `fetchUrls`, then every other
 * thumbnail (`sceneImageBytes`), and decodes and uploads each of `decodeUrls` and every thumbnail
 * once its bytes arrive, so `useScenePair`'s render-phase bind finds it ready. A scene that leaves
 * the plan before its bytes arrive is dropped, not decoded; thumbnails never leave it.
 */
function useScenePrefetch(
  pairUrls: readonly string[],
  decodeUrls: readonly string[],
  fetchUrls: readonly string[],
  thumbUrls: ThumbnailPrefetch,
  renderer: { readonly current: THREE.WebGLRenderer | null },
): void {
  const pairKey = pairUrls.join('\n')
  useEffect(() => {
    const pending = (url: string): boolean => getCachedSceneTexture(url) === undefined
    const thumbPending = (url: string): boolean => getCachedSceneThumbnail(url) === undefined
    // Thumbnails are ~4 KB: the near ones start with the pair, since they are what the pair and
    // the next few scenes draw if their full images are late.
    sceneImageBytes.want(
      [...pairKey.split('\n').filter(pending), ...thumbUrls.near.filter(thumbPending)],
      [...decodeUrls.filter(pending), ...fetchUrls.filter(pending), ...thumbUrls.all.filter(thumbPending)],
    )

    let cancelled = false
    for (const url of decodeUrls) {
      const cached = getCachedSceneTexture(url)
      const decoded =
        cached !== undefined ? Promise.resolve(cached) : sceneImageBytes.whenStored(url).then(() => loadSceneTexture(url))
      decoded
        .then((texture) => {
          // An evicted texture uploaded here would never be disposed again.
          if (!cancelled && getCachedSceneTexture(url) === texture) renderer.current?.initTexture(texture)
        })
        .catch((error: unknown) => {
          if (!isAbortError(error)) console.error(error)
        })
    }
    return () => {
      cancelled = true
    }
  }, [pairKey, decodeUrls, fetchUrls, thumbUrls, renderer])

  // Declared after the `want` above, so every thumbnail is already wanted when this first runs.
  useEffect(() => {
    let cancelled = false
    for (const url of thumbUrls.all) {
      if (getCachedSceneThumbnail(url) !== undefined) continue
      sceneImageBytes
        .whenStored(url)
        .then(() => loadSceneThumbnail(url))
        .then((texture) => {
          if (!cancelled) renderer.current?.initTexture(texture)
        })
        .catch((error: unknown) => {
          if (!isAbortError(error)) console.error(error)
        })
    }
    return () => {
      cancelled = true
    }
  }, [thumbUrls.all, renderer])
}

export function SceneCanvasView({
  baseUrl,
  overlayUrl,
  baseThumbUrl,
  overlayThumbUrl,
  decodeUrls,
  fetchUrls,
  thumbUrls,
  regime,
  mix,
  fromDrift,
  toDrift,
  imageAspect,
  cropByUrl,
}: SceneCanvasViewProps) {
  const pair = useScenePair(baseUrl, baseThumbUrl, overlayUrl, overlayThumbUrl)
  const renderer = useRef<THREE.WebGLRenderer | null>(null)
  useScenePrefetch([baseUrl, overlayUrl], decodeUrls, fetchUrls, thumbUrls, renderer)
  const dpr = useSceneCanvasDpr()

  // The uniforms below must always describe whichever pair `pair` actually has textures bound
  // for, not the (baseUrl, overlayUrl) pair `t` is currently requesting — see `sceneRender.ts`'s
  // doc comment for why the two can disagree, and `useScenePair`'s for why `pair` itself can lag.
  const render = resolveSceneRender({ fromUrl: baseUrl, toUrl: overlayUrl }, pair, { mix, fromDrift, toDrift })

  // 'demand': every uniform below is set as a JSX prop (`uniforms-x-value`), which r3f's own
  // prop-diffing invalidates on change (`uFromOffset`/`uToOffset` are the one exception —
  // mutated in place inside `SceneQuad`, which requests its own frame explicitly; see its own
  // comment). A `t`-driven re-render — playback, scrubbing, the drift breathe, the dissolve's
  // own rAF catch-up (`presentation.ts`) — always changes at least one such prop, so this
  // renders exactly the frames 'always' would while something is moving, and none of the ones
  // it wouldn't. A caller wanting a lower rate throttles the `t` it derives these props from
  // (`SceneView`'s `covered`) rather than stopping the loop.
  return (
    <Canvas
      orthographic
      dpr={dpr}
      frameloop="demand"
      gl={{ antialias: false, alpha: false }}
      style={canvasStyle}
      onCreated={({ gl }) => {
        renderer.current = gl
      }}
    >
      <SceneQuad
        from={render?.from ?? null}
        to={render?.to ?? null}
        regime={regime}
        mix={render?.mix ?? mix}
        fromDrift={render?.fromDrift ?? fromDrift}
        toDrift={render?.toDrift ?? toDrift}
        imageAspect={imageAspect}
        fromCrop={cropOf(cropByUrl, render?.from.url)}
        toCrop={cropOf(cropByUrl, render?.to.url)}
      />
    </Canvas>
  )
}

function cropOf(cropByUrl: ReadonlyMap<string, SceneCrop>, url: string | undefined): SceneCrop {
  return (url === undefined ? undefined : cropByUrl.get(url)) ?? CENTRED_CROP
}

interface SceneQuadProps {
  from: BoundSceneLayer | null
  to: BoundSceneLayer | null
  regime: PresentationRegime
  mix: number
  fromDrift: DriftUniforms
  toDrift: DriftUniforms
  imageAspect: number
  fromCrop: SceneCrop
  toCrop: SceneCrop
}

/**
 * Each drawn scene's sharpness (1 full image, 0 thumbnail) at a frame's wall-clock time: 1 at once
 * for a scene first drawn with its full image or sharpened under `'cut'`, ramping over
 * `SHARPEN_SECONDS` from when a drawn thumbnail's full image landed under `'crossfade'`
 * (`sceneLayer.ts`). Tracked per scene rather than per channel, so a fade carries on when the
 * scene moves from one channel to the other at a transition.
 */
function useSharpness(
  from: BoundSceneLayer | null,
  to: BoundSceneLayer | null,
  regime: PresentationRegime,
): (layer: BoundSceneLayer | null, now: number) => number {
  const drawn = useRef(new Map<string, BoundSceneLayer>())
  const fadeStartedAt = useRef(new Map<string, number>())
  const layers = [from, to].filter((layer): layer is BoundSceneLayer => layer !== null)
  for (const url of [...drawn.current.keys()]) {
    if (layers.some((layer) => layer.url === url)) continue
    drawn.current.delete(url)
    fadeStartedAt.current.delete(url)
  }
  for (const layer of layers) {
    const previous = drawn.current.get(layer.url) ?? null
    if (previous === layer) continue
    const change = sharpening(previous, layer, regime)
    if (change === 'fade') fadeStartedAt.current.set(layer.url, performance.now())
    if (change === 'cut') fadeStartedAt.current.delete(layer.url)
    drawn.current.set(layer.url, layer)
  }
  return (layer, now) => {
    if (layer === null || layer.full === null) return 0
    const startedAt = fadeStartedAt.current.get(layer.url)
    if (layer.thumb === null || startedAt === undefined) return 1
    return Math.min(1, Math.max(0, (now - startedAt) / (SHARPEN_SECONDS * 1000)))
  }
}

function SceneQuad({ from, to, regime, mix, fromDrift, toDrift, imageAspect, fromCrop, toCrop }: SceneQuadProps) {
  const { size, invalidate } = useThree()
  const laidOut = size.width > 0 && size.height > 0 && imageAspect > 0
  const viewportAspect = laidOut ? size.width / size.height : imageAspect
  const fromWindow = laidOut ? coverWindow(imageAspect, viewportAspect, fromCrop) : FULL_IMAGE
  const toWindow = laidOut ? coverWindow(imageAspect, viewportAspect, toCrop) : FULL_IMAGE

  const uniforms = useMemo(
    () => ({
      uFrom: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uTo: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uFromThumb: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uToThumb: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uFromSharp: { value: 1 },
      uToSharp: { value: 1 },
      uMix: { value: 0 },
      uFromWindow: { value: new THREE.Vector4(0, 0, 1, 1) },
      uToWindow: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFromThumbWindow: { value: new THREE.Vector4(0, 0, 1, 1) },
      uToThumbWindow: { value: new THREE.Vector4(0, 0, 1, 1) },
      uFromZoom: { value: 1 },
      uFromOffset: { value: new THREE.Vector2(0, 0) },
      uToZoom: { value: 1 },
      uToOffset: { value: new THREE.Vector2(0, 0) },
    }),
    [],
  )

  // Mutate the persistent vectors created once above rather than handing the shader fresh ones
  // every render — SceneQuad re-renders on every `t` tick during scrubbing/playback, so a
  // `new THREE.Vector2(...)` here would be a per-frame allocation in a hot path.
  uniforms.uFromOffset.value.set(fromDrift.dx, fromDrift.dy)
  uniforms.uToOffset.value.set(toDrift.dx, toDrift.dy)
  setWindow(uniforms.uFromWindow.value, fromWindow)
  setWindow(uniforms.uToWindow.value, toWindow)
  const squareAspect = imageAspect > 0 ? imageAspect : 1
  setWindow(uniforms.uFromThumbWindow.value, centreSquareWindow(fromWindow, squareAspect))
  setWindow(uniforms.uToThumbWindow.value, centreSquareWindow(toWindow, squareAspect))

  // A prop for the frame this render produces, then written to the material every frame until a
  // sharpening fade finishes. (r3f copies each uniform entry, so only a mutated object value, like
  // the vectors above, reaches the material through `uniforms`; a number must be written to it.)
  const sharpness = useSharpness(from, to, regime)
  const renderedAt = performance.now()
  const material = useRef<THREE.ShaderMaterial>(null)
  useFrame(() => {
    const target = material.current
    if (target === null) return
    const now = performance.now()
    const fromSharp = sharpness(from, now)
    const toSharp = sharpness(to, now)
    target.uniforms.uFromSharp!.value = fromSharp
    target.uniforms.uToSharp!.value = toSharp
    const fading = (sharp: number, layer: BoundSceneLayer | null): boolean => sharp < 1 && layer !== null && layer.full !== null
    if (fading(fromSharp, from) || fading(toSharp, to)) invalidate()
  })

  // The mutations above are the uniform updates in this component that do *not* go through a
  // JSX prop (every other one below is `uniforms-x-value={...}`, which r3f's own prop-diffing
  // invalidates on change automatically) — so on a `frameloop="demand"` canvas, request this
  // frame explicitly whenever any of them changes.
  useEffect(() => {
    invalidate()
  }, [
    fromDrift.dx,
    fromDrift.dy,
    toDrift.dx,
    toDrift.dy,
    fromWindow.x,
    fromWindow.y,
    fromWindow.width,
    fromWindow.height,
    toWindow.x,
    toWindow.y,
    toWindow.width,
    toWindow.height,
    invalidate,
  ])

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={material}
        vertexShader={SCENE_VERTEX_SHADER}
        fragmentShader={SCENE_FRAGMENT_SHADER}
        uniforms={uniforms}
        uniforms-uFrom-value={from?.full ?? PLACEHOLDER_TEXTURE}
        uniforms-uTo-value={to?.full ?? PLACEHOLDER_TEXTURE}
        uniforms-uFromThumb-value={from?.thumb ?? PLACEHOLDER_TEXTURE}
        uniforms-uToThumb-value={to?.thumb ?? PLACEHOLDER_TEXTURE}
        uniforms-uFromSharp-value={sharpness(from, renderedAt)}
        uniforms-uToSharp-value={sharpness(to, renderedAt)}
        uniforms-uMix-value={mix}
        uniforms-uFromZoom-value={fromDrift.zoom}
        uniforms-uToZoom-value={toDrift.zoom}
      />
    </mesh>
  )
}

const FULL_IMAGE: CoverWindow = { x: 0, y: 0, width: 1, height: 1 }

function setWindow(target: THREE.Vector4, window: CoverWindow): void {
  target.set(window.x, window.y, window.width, window.height)
}

const canvasStyle: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }
