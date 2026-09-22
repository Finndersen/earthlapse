'use client'

/**
 * WebGL renderer for the ancestor portrait: one quad whose fragment shader warps both plates
 * along their flow fields and blends them (`portraitShaders.ts`). Texture loads go through
 * `portraitTextures`/`usePortraitPair`, which keep the previously bound set on screen until a
 * newly requested set has fully loaded, so this never shows a blank frame; the plates and flow
 * textures just outside the current pair are preloaded speculatively (`preloadUrls`, computed
 * by `AncestorPortrait`'s `portraitNeighbourUrls`). `portraitRender.ts`'s `resolvePortraitRender`
 * reconciles that bound set against `alpha`/`forwardRange`/`backwardRange` (computed for the set
 * being *requested*, which can outrun what's actually bound) so the uniforms rendered always
 * describe the bound set, never a stale texture under a newer set's alpha or flow. This
 * component also tracks the single plate texture it last actually drew and feeds it back in as
 * `resolvePortraitRender`'s continuity fallback for the rare case where the bound set shares no
 * plate at all with what's requested.
 */

import { Canvas } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react'
import type * as THREE from 'three'

import { resolvePortraitRender, type PortraitRender } from '../portraitRender'
import { PORTRAIT_FRAGMENT_SHADER, PORTRAIT_VERTEX_SHADER } from '../portraitShaders'
import { FLOW_PLACEHOLDER, loadPortraitTexture, PLATE_PLACEHOLDER, retainPortraitTextures } from '../portraitTextures'
import { usePortraitPair, type PortraitFlow } from '../usePortraitPair'

export interface PortraitCanvasProps {
  olderUrl: string
  youngerUrl: string
  /** Null crossfades without warping. */
  flow: PortraitFlow | null
  /** Eased blend: 0 the older plate alone, 1 the younger. */
  alpha: number
  /** URLs of the plates and flow textures just outside the current pair — warmed into the
   *  texture cache ahead of need, same idea as `scene/SceneCanvasView.tsx`'s `preloadUrls`. */
  preloadUrls: readonly string[]
}

function usePreloadPortraitTextures(urls: readonly string[]): void {
  const key = urls.join('|')
  useEffect(() => {
    if (key.length === 0) return
    for (const url of key.split('|')) {
      loadPortraitTexture(url).catch((error: unknown) => console.error(error))
    }
  }, [key])
}

export function PortraitCanvas({ olderUrl, youngerUrl, flow, alpha, preloadUrls }: PortraitCanvasProps) {
  const pair = usePortraitPair(olderUrl, youngerUrl, flow)
  usePreloadPortraitTextures(preloadUrls)

  // The last single plate texture actually drawn — fed back into `resolvePortraitRender`'s
  // "no plate in common" fallback so it freezes on continuity with what was just on screen
  // rather than a fixed side of the (possibly several-frames-stale) bound set. Mutated directly
  // in the render body, same pattern `presentedMix.ts`'s `useRateLimitedState` uses for its own
  // "latest value for a later read" ref.
  const lastDrawnTexRef = useRef<THREE.Texture | null>(null)

  // The uniforms below must always describe whichever set `pair` actually has textures bound
  // for, not the (olderUrl, youngerUrl, flow) set `t` is currently requesting — see
  // `portraitRender.ts`'s doc comment for why the two can disagree, and `usePortraitPair`'s for
  // why `pair` itself can lag.
  const render = resolvePortraitRender(
    { olderUrl, youngerUrl, flow },
    pair,
    { alpha, forwardRange: flow?.forwardRange ?? 0, backwardRange: flow?.backwardRange ?? 0 },
    lastDrawnTexRef.current,
  )
  if (render !== null) {
    lastDrawnTexRef.current = render.alpha < 0.5 ? render.olderTex : render.youngerTex
  }

  // The "no plate in common" fallback can draw a plate from an earlier bound set, which
  // `usePortraitPair` no longer retains, so everything drawn is retained here too.
  const drawnOlder = render?.olderTex ?? null
  const drawnYounger = render?.youngerTex ?? null
  useLayoutEffect(() => retainPortraitTextures([drawnOlder, drawnYounger]), [drawnOlder, drawnYounger])

  return (
    <Canvas orthographic dpr={[1, 2]} gl={{ antialias: false, alpha: false }} style={canvasStyle}>
      <PortraitQuad render={render} />
    </Canvas>
  )
}

interface PortraitQuadProps {
  render: PortraitRender | null
}

function PortraitQuad({ render }: PortraitQuadProps) {
  const uniforms = useMemo(
    () => ({
      uOlder: { value: PLATE_PLACEHOLDER as THREE.Texture },
      uYounger: { value: PLATE_PLACEHOLDER as THREE.Texture },
      uForward: { value: FLOW_PLACEHOLDER as THREE.Texture },
      uBackward: { value: FLOW_PLACEHOLDER as THREE.Texture },
      uForwardRange: { value: 0 },
      uBackwardRange: { value: 0 },
      uAlpha: { value: 0 },
      uHasFlow: { value: 0 },
    }),
    [],
  )

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={PORTRAIT_VERTEX_SHADER}
        fragmentShader={PORTRAIT_FRAGMENT_SHADER}
        uniforms={uniforms}
        uniforms-uOlder-value={render?.olderTex ?? PLATE_PLACEHOLDER}
        uniforms-uYounger-value={render?.youngerTex ?? PLATE_PLACEHOLDER}
        uniforms-uForward-value={render?.forwardTex ?? FLOW_PLACEHOLDER}
        uniforms-uBackward-value={render?.backwardTex ?? FLOW_PLACEHOLDER}
        uniforms-uForwardRange-value={render?.forwardRange ?? 0}
        uniforms-uBackwardRange-value={render?.backwardRange ?? 0}
        uniforms-uAlpha-value={render?.alpha ?? 0}
        uniforms-uHasFlow-value={render?.hasFlow ? 1 : 0}
      />
    </mesh>
  )
}

const canvasStyle: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }
