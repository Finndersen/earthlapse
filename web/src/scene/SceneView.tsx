'use client'

/**
 * `<SceneView>` — the scene viewport (DESIGN §5 v1 note / ADR-009: still no depth maps, but
 * the flat cross-fade is gone). Picks between two renderers of the same `sceneAt` pair:
 * `SceneCanvasView`, a WebGL full-viewport quad whose fragment shader does a clean
 * noise-masked dissolve + blur-through instead of a flat opacity ramp (`transition.ts` /
 * `shaders.ts`), or `SceneFallbackView`, the original two-`<img>` cross-fade with a CSS
 * stand-in for the same two effects, when WebGL is unavailable. Both renderers apply each
 * scene's own camera drift (`drift.ts`) for a slow "3D photo" breathe.
 *
 * Prop-driven and pure in `t`, plus the OS reduced-motion preference — UI view state, not
 * part of the `t -> pixels` contract, per `useReducedMotion`'s doc comment. No store import,
 * matches DESIGN §10 / the Layer convention.
 */

import { type ReactNode, useMemo } from 'react'

import type { GeoTime } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { driftAt, REST_DRIFT } from './drift'
import { captionOpacity, dominantScene, resolveAssetUrl, sceneAt } from './scene'
import { SceneCanvasView } from './SceneCanvasView'
import { SceneFallbackView } from './SceneFallbackView'
import { transitionUniforms } from './transition'
import { useReducedMotion } from './useReducedMotion'
import { supportsWebGL } from './webgl'

export interface SceneViewProps {
  t: GeoTime
  /** Sorted ascending by `t` — see `sceneAt`. */
  scenes: Scene[]
  assetBase: string
  /** Renders the caption for whichever of the current pair is dominant (`dominantScene`),
   *  and its cross-fade opacity (`captionOpacity`, a pure function of `mix`, in sync with the
   *  image dissolve). Positioning and styling are entirely the returned node's — SceneView
   *  applies neither. */
  renderCaption?: (scene: Scene, opacity: number) => ReactNode
  className?: string
}

function sceneIndex(scenes: readonly Scene[], scene: Scene): number {
  return scenes.findIndex((s) => s.id === scene.id)
}

function neighbourUrls(scenes: readonly Scene[], fromIndex: number, toIndex: number, assetBase: string): string[] {
  const lo = Math.min(fromIndex, toIndex)
  const hi = Math.max(fromIndex, toIndex)
  const urls: string[] = []
  const before = scenes[lo - 1]
  const after = scenes[hi + 1]
  if (before !== undefined) urls.push(resolveAssetUrl(assetBase, before.image))
  if (after !== undefined) urls.push(resolveAssetUrl(assetBase, after.image))
  return urls
}

export function SceneView({ t, scenes, assetBase, renderCaption, className }: SceneViewProps): ReactNode {
  const reducedMotion = useReducedMotion()
  const webgl = useMemo(() => supportsWebGL(), [])

  const pair = useMemo(() => sceneAt(scenes, t), [scenes, t])
  const fromIndex = useMemo(() => sceneIndex(scenes, pair.from), [scenes, pair.from])
  const toIndex = useMemo(() => sceneIndex(scenes, pair.to), [scenes, pair.to])

  const fromDrift = reducedMotion ? REST_DRIFT : driftAt(scenes, fromIndex, t)
  const toDrift = reducedMotion ? REST_DRIFT : driftAt(scenes, toIndex, t)
  const transition = useMemo(() => transitionUniforms(pair.mix), [pair.mix])

  const baseUrl = resolveAssetUrl(assetBase, pair.from.image)
  const overlayUrl = resolveAssetUrl(assetBase, pair.to.image)
  const preloadUrls = useMemo(
    () => neighbourUrls(scenes, fromIndex, toIndex, assetBase),
    [scenes, fromIndex, toIndex, assetBase],
  )

  const caption = renderCaption?.(dominantScene(pair), captionOpacity(pair.mix))

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {webgl ? (
        <SceneCanvasView
          baseUrl={baseUrl}
          overlayUrl={overlayUrl}
          preloadUrls={preloadUrls}
          transition={transition}
          fromDrift={fromDrift}
          toDrift={toDrift}
          imageAspect={pair.from.width / pair.from.height}
        />
      ) : (
        <SceneFallbackView
          baseUrl={baseUrl}
          overlayUrl={overlayUrl}
          baseCaption={pair.from.caption}
          overlayCaption={pair.to.caption}
          preloadUrls={preloadUrls}
          transition={transition}
          fromDrift={fromDrift}
          toDrift={toDrift}
        />
      )}
      {caption}
    </div>
  )
}
