'use client'

/**
 * The globe view (DESIGN §7). A three.js sphere, independent of the scene view, driven only
 * by `t`. See `index.ts` for the props contract.
 */

import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type MouseEvent, type PointerEvent } from 'react'
import * as THREE from 'three'

import type { RasterData } from '@/data/curated'
import type { GeoTime } from '@/types/layer'

import { globeBlendAt, globeUniforms } from './blend'
import styles from './Globe.module.css'
import {
  ATMOSPHERE_SCALE,
  GLOBE_FRAGMENT_SHADER,
  GLOBE_VERTEX_SHADER,
  RIM_FRAGMENT_SHADER,
  RIM_VERTEX_SHADER,
} from './shaders'
import { PLACEHOLDER_TEXTURE } from './textureCache'
import { useGlobeTexturePair } from './useGlobeTexturePair'

const OUT_OF_DOMAIN_LABEL = 'No reconstruction before 540 Ma'
const AUTO_ROTATE_RADIANS_PER_SECOND = 0.025
const RIM_COLOR = new THREE.Color('#8fc7ff')
/** Far enough back (with the 40° fov) that the sphere and its atmosphere shell sit whole
 *  inside the canvas with a margin — the orb reads as a floating object, never a disc
 *  clipped square. The planet's silhouette lands at ≈76% of the canvas half-size, which
 *  Globe.module.css's halo and expand ring are sized against. */
const CAMERA_DISTANCE = 3.6

export interface GlobeProps {
  t: GeoTime
  rasterData: RasterData
  assetBase: string
  expanded: boolean
  onToggleExpand: () => void
}

export function Globe({ t, rasterData, assetBase, expanded, onToggleExpand }: GlobeProps) {
  const blend = useMemo(() => globeBlendAt(rasterData, t, assetBase), [rasterData, t, assetBase])
  const domain = globeUniforms(blend)
  const pair = useGlobeTexturePair(blend)
  // Gates the shader's textured look: even in-domain, don't show data until the first pair
  // has actually loaded. Distinct from `domain.hasData`, which alone decides the "no
  // reconstruction" label below — that label must reflect the *domain*, not load state, or
  // it would falsely claim "no reconstruction" while in-domain textures are still in flight.
  const showTexture = domain.hasData && pair.texturesReady
  const mix = showTexture ? pair.mix : 0

  useCloseOnEscape(expanded, onToggleExpand)

  // Closing on a backdrop click only when the press also *started* on the backdrop: a drag
  // that rotates the globe and happens to be released outside it must not dismiss it.
  const pressStartedOnBackdrop = useRef(false)
  const onBackdropPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    pressStartedOnBackdrop.current = e.target === e.currentTarget
  }
  const onBackdropClick = (e: MouseEvent<HTMLDivElement>): void => {
    if (pressStartedOnBackdrop.current && e.target === e.currentTarget) onToggleExpand()
  }

  // The element types and order stay identical across both states so toggling restyles the
  // same <Canvas> rather than remounting it (a new WebGL context and texture re-upload).
  return (
    <div
      className={expanded ? styles.backdrop : styles.root}
      onPointerDown={expanded ? onBackdropPointerDown : undefined}
      onClick={expanded ? onBackdropClick : undefined}
    >
      <div className={expanded ? styles.orbExpanded : styles.orb}>
        <div className={styles.halo} aria-hidden="true" />
        <Canvas camera={{ position: [0, 0, CAMERA_DISTANCE], fov: 40 }} dpr={[1, 2]} gl={{ alpha: true }}>
          <GlobeSphere beforeTex={pair.beforeTex} afterTex={pair.afterTex} mix={mix} hasData={showTexture} />
          <AtmosphereRim />
          <OrbitControls enableZoom={expanded} enablePan={false} enableRotate={expanded} rotateSpeed={0.6} />
        </Canvas>

        {!domain.hasData && (
          <div className={styles.outOfDomain} aria-live="polite">
            {OUT_OF_DOMAIN_LABEL}
          </div>
        )}

        {!expanded && (
          <button type="button" className={styles.expandButton} onClick={onToggleExpand} aria-label="Expand globe" />
        )}
      </div>

      {expanded && (
        <button type="button" className={styles.closeButton} onClick={onToggleExpand} aria-label="Collapse globe">
          ✕
        </button>
      )}
    </div>
  )
}

/** Escape collapses the expanded globe. The latest callback is read through a ref so the
 *  listener isn't re-subscribed on every render (the globe re-renders every playback frame). */
function useCloseOnEscape(expanded: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded])
}

// ------------------------------------------------------------------------------- sphere

interface GlobeSphereProps {
  beforeTex: THREE.Texture | null
  afterTex: THREE.Texture | null
  mix: number
  hasData: boolean
}

function GlobeSphere({ beforeTex, afterTex, mix, hasData }: GlobeSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null)

  const uniforms = useMemo(
    () => ({
      uBefore: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uAfter: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uMix: { value: 0 },
      uHasData: { value: 0 },
    }),
    [],
  )

  useFrame((_state, delta) => {
    const mesh = meshRef.current
    if (mesh !== null) mesh.rotation.y += delta * AUTO_ROTATE_RADIANS_PER_SECOND
  })

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1, 64, 64]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={GLOBE_VERTEX_SHADER}
        fragmentShader={GLOBE_FRAGMENT_SHADER}
        uniforms-uBefore-value={beforeTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uAfter-value={afterTex ?? PLACEHOLDER_TEXTURE}
        uniforms-uMix-value={mix}
        uniforms-uHasData-value={hasData ? 1 : 0}
      />
    </mesh>
  )
}

// --------------------------------------------------------------------------- atmosphere

function AtmosphereRim() {
  const uniforms = useMemo(() => ({ uColor: { value: RIM_COLOR } }), [])

  return (
    <mesh scale={ATMOSPHERE_SCALE}>
      <sphereGeometry args={[1, 48, 48]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={RIM_VERTEX_SHADER}
        fragmentShader={RIM_FRAGMENT_SHADER}
        transparent
        depthWrite={false}
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}
