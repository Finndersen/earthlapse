'use client'

/**
 * WebGL renderer for the ancestor portrait: one quad whose fragment shader warps both plates
 * along their flow fields and blends them (`portraitShaders.ts`). The previously bound set of
 * textures stays on screen until a newly requested set has fully loaded, so the plate never
 * blanks while scrubbing.
 */

import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type * as THREE from 'three'

import { PORTRAIT_FRAGMENT_SHADER, PORTRAIT_VERTEX_SHADER } from '../portraitShaders'
import { FLOW_PLACEHOLDER, loadPortraitTexture, PLATE_PLACEHOLDER } from '../portraitTextures'

export interface PortraitFlow {
  forwardUrl: string
  backwardUrl: string
  forwardRange: number
  backwardRange: number
}

export interface PortraitCanvasProps {
  olderUrl: string
  youngerUrl: string
  /** Null crossfades without warping. */
  flow: PortraitFlow | null
  /** Eased blend: 0 the older plate alone, 1 the younger. */
  alpha: number
}

interface BoundTextures {
  key: string
  older: THREE.Texture
  younger: THREE.Texture
  forward: THREE.Texture | null
  backward: THREE.Texture | null
}

function usePortraitTextures(olderUrl: string, youngerUrl: string, flow: PortraitFlow | null): BoundTextures | null {
  const key = [olderUrl, youngerUrl, flow?.forwardUrl ?? '', flow?.backwardUrl ?? ''].join('|')
  const [bound, setBound] = useState<BoundTextures | null>(null)
  const boundKey = bound?.key ?? null

  useEffect(() => {
    if (boundKey === key) return undefined
    const [older, younger, forward, backward] = key.split('|') as [string, string, string, string]
    let cancelled = false
    void Promise.all([
      loadPortraitTexture(older),
      loadPortraitTexture(younger),
      forward === '' ? Promise.resolve(null) : loadPortraitTexture(forward),
      backward === '' ? Promise.resolve(null) : loadPortraitTexture(backward),
    ])
      .then(([olderTex, youngerTex, forwardTex, backwardTex]) => {
        if (!cancelled) {
          setBound({ key, older: olderTex, younger: youngerTex, forward: forwardTex, backward: backwardTex })
        }
      })
      .catch((error: unknown) => {
        // Keep the bound set on screen; a bad ref is a publish problem to fix upstream.
        console.error(error)
      })
    return () => {
      cancelled = true
    }
  }, [key, boundKey])

  return bound
}

export function PortraitCanvas({ olderUrl, youngerUrl, flow, alpha }: PortraitCanvasProps) {
  const textures = usePortraitTextures(olderUrl, youngerUrl, flow)
  return (
    <Canvas orthographic dpr={[1, 2]} gl={{ antialias: false, alpha: false }} style={canvasStyle}>
      <PortraitQuad textures={textures} flow={flow} alpha={alpha} />
    </Canvas>
  )
}

interface PortraitQuadProps {
  textures: BoundTextures | null
  flow: PortraitFlow | null
  alpha: number
}

function PortraitQuad({ textures, flow, alpha }: PortraitQuadProps) {
  const uniforms = useMemo(
    () => ({
      uOlder: { value: PLATE_PLACEHOLDER },
      uYounger: { value: PLATE_PLACEHOLDER },
      uForward: { value: FLOW_PLACEHOLDER },
      uBackward: { value: FLOW_PLACEHOLDER },
      uForwardRange: { value: 0 },
      uBackwardRange: { value: 0 },
      uAlpha: { value: 0 },
      uHasFlow: { value: 0 },
    }),
    [],
  )
  // Warp only with the flow fields bound for exactly the plates on screen.
  const warp = flow !== null && textures?.forward != null && textures.backward != null

  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        vertexShader={PORTRAIT_VERTEX_SHADER}
        fragmentShader={PORTRAIT_FRAGMENT_SHADER}
        uniforms={uniforms}
        uniforms-uOlder-value={textures?.older ?? PLATE_PLACEHOLDER}
        uniforms-uYounger-value={textures?.younger ?? PLATE_PLACEHOLDER}
        uniforms-uForward-value={textures?.forward ?? FLOW_PLACEHOLDER}
        uniforms-uBackward-value={textures?.backward ?? FLOW_PLACEHOLDER}
        uniforms-uForwardRange-value={flow?.forwardRange ?? 0}
        uniforms-uBackwardRange-value={flow?.backwardRange ?? 0}
        uniforms-uAlpha-value={alpha}
        uniforms-uHasFlow-value={warp ? 1 : 0}
      />
    </mesh>
  )
}

const canvasStyle: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }
