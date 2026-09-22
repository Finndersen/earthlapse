'use client'

/**
 * WebGL scene renderer: a full-viewport quad (react-three-fiber) whose fragment shader does the
 * smooth whole-image crossfade (`shaders.ts`, ADR-012), each layer's own focus-centred crop
 * (`framing.ts`, ADR-045, ADR-047) and camera drift (`drift.ts`) in one pass — no stacked DOM layers, no double exposure. Texture loads go through
 * `textureCache`/`useScenePair`, which keep the previously bound pair on screen until a newly
 * requested pair has fully loaded, so this never shows a blank or black frame; scenes just
 * outside the current pair are preloaded speculatively. `sceneRender.ts`'s `resolveSceneRender`
 * reconciles that bound pair against `mix`/`fromDrift`/`toDrift` (computed for the pair being
 * *requested*, which can outrun what's bound) so the rendered uniforms always describe the
 * bound pair, never a stale texture under a newer pair's drift.
 */

import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo, type CSSProperties } from 'react'
import * as THREE from 'three'

import { useSceneCanvasDpr } from './canvasBudget'
import type { DriftUniforms } from './drift'
import { CENTRED_CROP, coverWindow, type CoverWindow, type SceneCrop } from './framing'
import { resolveSceneRender } from './sceneRender'
import { SCENE_FRAGMENT_SHADER, SCENE_VERTEX_SHADER } from './shaders'
import { loadSceneTexture, PLACEHOLDER_TEXTURE } from './textureCache'
import { useScenePair } from './useScenePair'

export interface SceneCanvasViewProps {
  baseUrl: string
  overlayUrl: string
  /** URLs of the scenes just outside the current pair — warmed into the texture cache ahead
   *  of need, same idea as `globe`'s neighbour preload. */
  preloadUrls: readonly string[]
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

function usePreloadTextures(urls: readonly string[]): void {
  const key = urls.join('|')
  useEffect(() => {
    if (key.length === 0) return
    for (const url of key.split('|')) {
      loadSceneTexture(url).catch((error: unknown) => console.error(error))
    }
  }, [key])
}

export function SceneCanvasView({
  baseUrl,
  overlayUrl,
  preloadUrls,
  mix,
  fromDrift,
  toDrift,
  imageAspect,
  cropByUrl,
}: SceneCanvasViewProps) {
  const pair = useScenePair(baseUrl, overlayUrl)
  usePreloadTextures(preloadUrls)
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
    <Canvas orthographic dpr={dpr} frameloop="demand" gl={{ antialias: false, alpha: false }} style={canvasStyle}>
      <SceneQuad
        fromTex={render?.fromTex ?? null}
        toTex={render?.toTex ?? null}
        mix={render?.mix ?? mix}
        fromDrift={render?.fromDrift ?? fromDrift}
        toDrift={render?.toDrift ?? toDrift}
        imageAspect={imageAspect}
        fromCrop={cropOf(cropByUrl, render?.fromUrl)}
        toCrop={cropOf(cropByUrl, render?.toUrl)}
      />
    </Canvas>
  )
}

function cropOf(cropByUrl: ReadonlyMap<string, SceneCrop>, url: string | undefined): SceneCrop {
  return (url === undefined ? undefined : cropByUrl.get(url)) ?? CENTRED_CROP
}

interface SceneQuadProps {
  fromTex: THREE.Texture | null
  toTex: THREE.Texture | null
  mix: number
  fromDrift: DriftUniforms
  toDrift: DriftUniforms
  imageAspect: number
  fromCrop: SceneCrop
  toCrop: SceneCrop
}

function SceneQuad({ fromTex, toTex, mix, fromDrift, toDrift, imageAspect, fromCrop, toCrop }: SceneQuadProps) {
  const { size, invalidate } = useThree()
  const laidOut = size.width > 0 && size.height > 0 && imageAspect > 0
  const viewportAspect = laidOut ? size.width / size.height : imageAspect
  const fromWindow = laidOut ? coverWindow(imageAspect, viewportAspect, fromCrop) : FULL_IMAGE
  const toWindow = laidOut ? coverWindow(imageAspect, viewportAspect, toCrop) : FULL_IMAGE

  const uniforms = useMemo(
    () => ({
      uFrom: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uTo: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uMix: { value: 0 },
      uFromWindow: { value: new THREE.Vector4(0, 0, 1, 1) },
      uToWindow: { value: new THREE.Vector4(0, 0, 1, 1) },
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
        vertexShader={SCENE_VERTEX_SHADER}
        fragmentShader={SCENE_FRAGMENT_SHADER}
        uniforms={uniforms}
        uniforms-uFrom-value={fromTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uTo-value={toTex ?? PLACEHOLDER_TEXTURE}
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
