'use client'

/**
 * The globe view (DESIGN §7). A three.js sphere, independent of the scene view, driven only
 * by `t`. See `index.ts` for the props contract.
 */

import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef, type CSSProperties } from 'react'
import * as THREE from 'three'

import type { RasterData } from '@/data/curated'
import type { GeoTime } from '@/types/layer'

import { globeBlendAt, globeUniforms } from './blend'
import { GLOBE_FRAGMENT_SHADER, GLOBE_VERTEX_SHADER, RIM_FRAGMENT_SHADER, RIM_VERTEX_SHADER } from './shaders'
import { PLACEHOLDER_TEXTURE } from './textureCache'
import { useGlobeTexturePair } from './useGlobeTexturePair'

const OUT_OF_DOMAIN_LABEL = 'No reconstruction before 540 Ma'
const AUTO_ROTATE_RADIANS_PER_SECOND = 0.025
const RIM_COLOR = new THREE.Color('#8fc7ff')

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

  return (
    <div style={expanded ? styles.rootExpanded : styles.root}>
      <Canvas camera={{ position: [0, 0, 2.6], fov: 40 }} dpr={[1, 2]}>
        <GlobeSphere beforeTex={pair.beforeTex} afterTex={pair.afterTex} mix={mix} hasData={showTexture} />
        <AtmosphereRim />
        <OrbitControls enableZoom={expanded} enablePan={false} enableRotate rotateSpeed={0.6} />
      </Canvas>

      {!domain.hasData && (
        <div style={styles.outOfDomainLabel} aria-live="polite">
          {OUT_OF_DOMAIN_LABEL}
        </div>
      )}

      <button
        type="button"
        onClick={onToggleExpand}
        style={styles.toggleButton}
        aria-label={expanded ? 'Collapse globe' : 'Expand globe'}
      >
        {expanded ? '✕' : '⤢'}
      </button>
    </div>
  )
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
    <mesh scale={1.04}>
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

// -------------------------------------------------------------------------------- styles

const styles: Record<string, CSSProperties> = {
  root: {
    position: 'relative',
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    overflow: 'hidden',
  },
  rootExpanded: {
    position: 'fixed',
    inset: 0,
    width: '100vw',
    height: '100vh',
    zIndex: 50,
    borderRadius: 0,
    overflow: 'hidden',
    background: 'rgba(4, 6, 10, 0.92)',
  },
  outOfDomainLabel: {
    position: 'absolute',
    left: '50%',
    bottom: '10%',
    transform: 'translateX(-50%)',
    fontSize: '0.7rem',
    letterSpacing: '0.02em',
    color: 'rgba(255, 255, 255, 0.65)',
    textAlign: 'center',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  },
  toggleButton: {
    position: 'absolute',
    top: '0.4rem',
    right: '0.4rem',
    width: '1.6rem',
    height: '1.6rem',
    lineHeight: '1.6rem',
    padding: 0,
    borderRadius: '50%',
    border: 'none',
    background: 'rgba(0, 0, 0, 0.45)',
    color: 'rgba(255, 255, 255, 0.85)',
    cursor: 'pointer',
    fontSize: '0.85rem',
  },
}
