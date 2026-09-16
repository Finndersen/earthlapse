'use client'

/**
 * `<SceneView>` — the scene viewport (DESIGN §5 v1 note / ADR-009: still no depth maps).
 * Picks between two renderers of the same presented scene pair: `SceneCanvasView`, a WebGL
 * full-viewport quad whose fragment shader does a smooth whole-image crossfade (`shaders.ts`,
 * ADR-012), or `SceneFallbackView`, a two-`<img>` opacity cross-fade, when WebGL is
 * unavailable. Both renderers apply each scene's own camera drift (`drift.ts`) for a slow
 * "3D photo" breathe.
 *
 * `sceneAt(scenes, t)` is the pure, instantaneous target — which two scenes and how far to
 * dissolve, a function of `t` alone. What is actually *displayed* goes through
 * `usePresentedSceneMix` (`presentation.ts`, ADR-012) first, which rate-limits how fast the
 * presentation can move so a full transition never completes in under
 * `MIN_TRANSITION_SECONDS` of wall-clock time, however abruptly `t` itself jumps.
 *
 * Prop-driven and pure in `t`, plus the OS reduced-motion preference and the presentation
 * catch-up's own wall-clock pacing — UI view state, not part of the `t -> pixels` contract,
 * per `useReducedMotion`'s doc comment. No store import, matches DESIGN §10 / the Layer
 * convention.
 */

import { type ReactNode, useMemo } from 'react'

import { supportsWebGL } from '@/lib/webgl'
import type { GeoTime } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { driftAt, REST_DRIFT } from './drift'
import { usePresentedSceneMix } from './presentation'
import { captionOpacity, dominantScene, resolveAssetUrl, sceneAt, type PresentationRegime } from './scene'
import { SceneCanvasView } from './SceneCanvasView'
import { SceneFallbackView } from './SceneFallbackView'
import { crossfadeAlpha } from './transition'
import { useReducedMotion } from './useReducedMotion'

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
  /** `'crossfade'` (default) or `'cut'` (ADR-029) — how far the presented mix follows `sceneAt`'s
   *  target this frame (`usePresentedSceneMix`'s own doc comment). Only `Experience.tsx`'s
   *  `'steady'`-mode playback loop ever passes `'cut'`; scrubbing, seeking, paused viewing and
   *  `'scenes'`-mode playback always render `'crossfade'`, matching today's behaviour exactly. */
  regime?: PresentationRegime
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

export function SceneView({ t, scenes, assetBase, renderCaption, className, regime = 'crossfade' }: SceneViewProps): ReactNode {
  const reducedMotion = useReducedMotion()
  const webgl = useMemo(() => supportsWebGL(), [])

  const target = useMemo(() => sceneAt(scenes, t), [scenes, t])
  const presented = usePresentedSceneMix(target, regime)

  const fromIndex = useMemo(() => sceneIndex(scenes, presented.from), [scenes, presented.from])
  const toIndex = useMemo(() => sceneIndex(scenes, presented.to), [scenes, presented.to])

  // Drift stays a function of the real `t`, not the catch-up mix — it is each on-screen
  // scene's own camera motion over the time it is actually being watched, unaffected by how
  // quickly the presentation caught up to it.
  const fromDrift = reducedMotion ? REST_DRIFT : driftAt(scenes, fromIndex, t)
  const toDrift = reducedMotion ? REST_DRIFT : driftAt(scenes, toIndex, t)
  const mix = crossfadeAlpha(presented.mix)

  const baseUrl = resolveAssetUrl(assetBase, presented.from.image)
  const overlayUrl = resolveAssetUrl(assetBase, presented.to.image)
  const preloadUrls = useMemo(
    () => neighbourUrls(scenes, fromIndex, toIndex, assetBase),
    [scenes, fromIndex, toIndex, assetBase],
  )

  const caption = renderCaption?.(dominantScene(presented), captionOpacity(presented.mix))

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {webgl ? (
        <SceneCanvasView
          baseUrl={baseUrl}
          overlayUrl={overlayUrl}
          preloadUrls={preloadUrls}
          mix={mix}
          fromDrift={fromDrift}
          toDrift={toDrift}
          imageAspect={presented.from.width / presented.from.height}
        />
      ) : (
        <SceneFallbackView
          baseUrl={baseUrl}
          overlayUrl={overlayUrl}
          baseCaption={presented.from.caption}
          overlayCaption={presented.to.caption}
          preloadUrls={preloadUrls}
          mix={mix}
          fromDrift={fromDrift}
          toDrift={toDrift}
        />
      )}
      {caption}
    </div>
  )
}
