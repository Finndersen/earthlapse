'use client'

/**
 * `<SceneView>` — the scene viewport (DESIGN §5 v1 note / ADR-009: still no depth maps). Picks
 * between two renderers of the same presented scene pair: `SceneCanvasView`, a WebGL
 * full-viewport quad whose fragment shader does a smooth whole-image crossfade (`shaders.ts`,
 * ADR-012), or `SceneFallbackView`, a two-`<img>` opacity cross-fade, when WebGL is
 * unavailable. Both crop each scene around its own focus (`framing.ts`, ADR-045, ADR-047) and apply its
 * own camera drift (`drift.ts`) for a slow "3D photo" breathe.
 *
 * `sceneAt(scenes, t)` is the pure, instantaneous target. What is actually *displayed* goes
 * through `usePresentedSceneMix` (`presentation.ts`, ADR-012) first, which rate-limits how fast
 * the presentation can move so a full transition never completes in under
 * `MIN_TRANSITION_SECONDS`, however abruptly `t` itself jumps.
 *
 * Prop-driven and pure in `t`, plus the OS reduced-motion preference and the presentation
 * catch-up's own pacing (UI view state, not part of the `t -> pixels` contract, per
 * `useReducedMotion`'s doc comment). No store import, matches DESIGN §10 / the Layer convention.
 */

import { type ReactNode, useMemo } from 'react'

import { useReducedMotion } from '@/lib/useReducedMotion'
import { useThrottledValue } from '@/lib/useThrottledValue'
import { supportsWebGL } from '@/lib/webgl'
import type { GeoTime } from '@/types/layer'
import type { Scene } from '@/types/manifest'

import { driftAt, REST_DRIFT } from './drift'
import { sceneCrop, type SceneCrop } from './framing'
import { planScenePrefetch } from './prefetch'
import { usePresentedSceneMix } from './presentation'
import { captionOpacity, dominantScene, resolveAssetUrl, sceneAt, type PresentationRegime } from './scene'
import { SceneCanvasView } from './SceneCanvasView'
import { SceneFallbackView } from './SceneFallbackView'
import { crossfadeAlpha } from './transition'

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
  /** `'crossfade'` (default) or `'cut'` (ADR-029) — see `usePresentedSceneMix`'s doc comment.
   *  Only `Experience.tsx`'s `'steady'`-mode playback loop ever passes `'cut'`; scrubbing,
   *  seeking, paused viewing and `'scenes'`-mode playback always render `'crossfade'`. */
  regime?: PresentationRegime
  /** True while the expanded globe/map backdrop sits over this view. That backdrop is
   *  translucent (`Globe.module.css`'s `.backdrop`: a 55-80% wash plus a 3px blur), so the scene
   *  stays visible through it and must keep drifting and crossing between scenes — it is only
   *  seen dimmed and blurred, which `COVERED_SCENE_THROTTLE_MS` is calibrated against. Default
   *  `false`. */
  covered?: boolean
  /** While playing: where playback puts `t` after `prefetch.ts`'s `PREFETCH_LOOKAHEAD_SECONDS`,
   *  so scenes ahead load in playback order. Omitted when paused or scrubbing. */
  prefetchHorizonT?: GeoTime
}

/** ~10fps for the scene behind the expanded globe's translucent, blurred backdrop: the drift is
 *  a slow breathe and the dissolve is rate-limited to seconds, neither of which reads as stepped
 *  at this rate through a 3px blur. */
const COVERED_SCENE_THROTTLE_MS = 100

function sceneIndex(scenes: readonly Scene[], scene: Scene): number {
  return scenes.findIndex((s) => s.id === scene.id)
}

function imageUrls(scenes: readonly Scene[], indices: readonly number[], assetBase: string): string[] {
  return indices.map((index) => resolveAssetUrl(assetBase, scenes[index]!.image))
}

/** `urls`, keeping the previous array while its contents are unchanged, so a per-frame plan only
 *  re-runs the renderers' prefetch effects when it actually changes. */
function useStableUrls(urls: string[]): readonly string[] {
  const key = urls.join('\n')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is `urls`' identity
  return useMemo(() => urls, [key])
}

function framedCropByUrl(scenes: readonly Scene[], assetBase: string): ReadonlyMap<string, SceneCrop> {
  const cropByUrl = new Map<string, SceneCrop>()
  for (const scene of scenes) {
    if (scene.framing !== undefined) cropByUrl.set(resolveAssetUrl(assetBase, scene.image), sceneCrop(scene.framing))
  }
  return cropByUrl
}

export function SceneView({
  t: rawT,
  scenes,
  assetBase,
  renderCaption,
  className,
  regime = 'crossfade',
  covered = false,
  prefetchHorizonT,
}: SceneViewProps): ReactNode {
  const reducedMotion = useReducedMotion()
  const webgl = useMemo(() => supportsWebGL(), [])

  // Every value below derives from this rather than the raw `t`, so a covered scene recomputes
  // its pair, mix and drift at the throttled rate instead of once per playback frame.
  const t = useThrottledValue(rawT, covered ? COVERED_SCENE_THROTTLE_MS : 0)

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
  const plan = planScenePrefetch(
    scenes,
    fromIndex,
    toIndex,
    prefetchHorizonT === undefined ? null : { t: rawT, horizonT: prefetchHorizonT },
  )
  const decodeUrls = useStableUrls(imageUrls(scenes, plan.decode, assetBase))
  const fetchUrls = useStableUrls(imageUrls(scenes, plan.fetch, assetBase))

  const cropByUrl = useMemo(() => framedCropByUrl(scenes, assetBase), [scenes, assetBase])
  const imageAspect = presented.from.width / presented.from.height

  const caption = renderCaption?.(dominantScene(presented), captionOpacity(presented.mix))

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {webgl ? (
        <SceneCanvasView
          baseUrl={baseUrl}
          overlayUrl={overlayUrl}
          decodeUrls={decodeUrls}
          fetchUrls={fetchUrls}
          mix={mix}
          fromDrift={fromDrift}
          toDrift={toDrift}
          imageAspect={imageAspect}
          cropByUrl={cropByUrl}
        />
      ) : (
        <SceneFallbackView
          baseUrl={baseUrl}
          overlayUrl={overlayUrl}
          baseCaption={presented.from.caption}
          overlayCaption={presented.to.caption}
          decodeUrls={decodeUrls}
          fetchUrls={fetchUrls}
          mix={mix}
          fromDrift={fromDrift}
          toDrift={toDrift}
          imageAspect={imageAspect}
          cropByUrl={cropByUrl}
        />
      )}
      {caption}
    </div>
  )
}
