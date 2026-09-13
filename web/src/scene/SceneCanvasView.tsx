'use client'

/**
 * WebGL scene renderer: a full-viewport quad (react-three-fiber) whose fragment shader does
 * the noise-masked dissolve + blur-through (`transition.ts` / `shaders.ts`) and each layer's
 * own camera drift (`drift.ts`) in one pass — no stacked DOM layers, no double exposure.
 * Texture loads go through `textureCache`/`useScenePair`, which keep the previously bound
 * pair on screen until a newly requested pair has fully loaded, so this never shows a blank
 * or black frame; the scenes just outside the current pair are preloaded speculatively.
 */

import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo, type CSSProperties } from 'react'
import * as THREE from 'three'

import type { DriftUniforms } from './drift'
import { SCENE_FRAGMENT_SHADER, SCENE_VERTEX_SHADER } from './shaders'
import { loadSceneTexture, PLACEHOLDER_TEXTURE } from './textureCache'
import type { TransitionUniforms } from './transition'
import { useScenePair, type ScenePair } from './useScenePair'

/** Scales `transition.blur` (a normalised 0..1 strength) to a UV-space blur radius. */
const UV_BLUR_RADIUS = 0.006

export interface SceneCanvasViewProps {
  baseUrl: string
  overlayUrl: string
  /** URLs of the scenes just outside the current pair — warmed into the texture cache ahead
   *  of need, same idea as `globe`'s neighbour preload. */
  preloadUrls: readonly string[]
  transition: TransitionUniforms
  fromDrift: DriftUniforms
  toDrift: DriftUniforms
  /** `from.width / from.height` — assumed shared across scenes (the generation pipeline
   *  renders every shot at the same dimensions, per VISUAL_SPEC's camera grammar). */
  imageAspect: number
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
  transition,
  fromDrift,
  toDrift,
  imageAspect,
}: SceneCanvasViewProps) {
  const pair = useScenePair(baseUrl, overlayUrl)
  usePreloadTextures(preloadUrls)

  return (
    <Canvas orthographic dpr={[1, 2]} gl={{ antialias: false, alpha: false }} style={canvasStyle}>
      <SceneQuad pair={pair} transition={transition} fromDrift={fromDrift} toDrift={toDrift} imageAspect={imageAspect} />
    </Canvas>
  )
}

interface SceneQuadProps {
  pair: ScenePair
  transition: TransitionUniforms
  fromDrift: DriftUniforms
  toDrift: DriftUniforms
  imageAspect: number
}

function SceneQuad({ pair, transition, fromDrift, toDrift, imageAspect }: SceneQuadProps) {
  const { size } = useThree()
  const viewportAspect = size.height > 0 ? size.width / size.height : 1
  const aspect = imageAspect > 0 ? viewportAspect / imageAspect : 1

  const uniforms = useMemo(
    () => ({
      uFrom: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uTo: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uThreshold: { value: 1 },
      uEdge: { value: 0 },
      uLuminanceBias: { value: 0 },
      uBlur: { value: 0 },
      uAspect: { value: 1 },
      uFromZoom: { value: 1 },
      uFromOffset: { value: new THREE.Vector2(0, 0) },
      uToZoom: { value: 1 },
      uToOffset: { value: new THREE.Vector2(0, 0) },
    }),
    [],
  )

  // Mutate the persistent Vector2s created once above rather than handing the shader a fresh
  // one every render — SceneQuad re-renders on every `t` tick during scrubbing/playback, so a
  // `new THREE.Vector2(...)` here would be a per-frame allocation in a hot path.
  uniforms.uFromOffset.value.set(fromDrift.dx, fromDrift.dy)
  uniforms.uToOffset.value.set(toDrift.dx, toDrift.dy)

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={SCENE_VERTEX_SHADER}
        fragmentShader={SCENE_FRAGMENT_SHADER}
        uniforms={uniforms}
        uniforms-uFrom-value={pair.fromTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uTo-value={pair.toTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uThreshold-value={transition.threshold}
        uniforms-uEdge-value={transition.edge}
        uniforms-uLuminanceBias-value={transition.luminanceBias}
        uniforms-uBlur-value={transition.blur * UV_BLUR_RADIUS}
        uniforms-uAspect-value={aspect}
        uniforms-uFromZoom-value={fromDrift.zoom}
        uniforms-uToZoom-value={toDrift.zoom}
      />
    </mesh>
  )
}

const canvasStyle: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }
