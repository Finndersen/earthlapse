'use client'

/**
 * The globe view (DESIGN §7). A three.js sphere, independent of the scene view, driven only
 * by `t`. See `index.ts` for the props contract.
 */

import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type MouseEvent, type PointerEvent } from 'react'
import * as THREE from 'three'

import type { GeoTime, TimelineEvent } from '@/types/layer'

import {
  globeMultiBlendAt,
  globeMultiCaptionFor,
  globeMultiPreloadUrls,
  globeUniforms,
  regimeEventsWithRasterFallback,
  travelDirection,
  type GlobeRasterLayers,
  type PreloadWindow,
  type TravelDirection,
} from './blend'
import { useGlobeEffects, type GlobeEffectUniforms } from './effects'
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

const AUTO_ROTATE_RADIANS_PER_SECOND = 0.025
const RIM_COLOR = new THREE.Color('#8fc7ff')
/** Far enough back (with the 40° fov) that the sphere and its atmosphere shell sit whole
 *  inside the canvas with a margin — the orb reads as a floating object, never a disc
 *  clipped square. The planet's silhouette lands at ≈76% of the canvas half-size, which
 *  Globe.module.css's halo and expand ring are sized against. */
const CAMERA_DISTANCE = 3.6
/** Frames are ~5-10 Myr apart across both raster sources; a few ahead covers fast playback
 *  through one network round trip, one behind covers a small scrub reversal. Must stay well
 *  inside textureCache's capacity. */
const PRELOAD_WINDOW: PreloadWindow = { ahead: 4, behind: 1 }

export interface GlobeProps {
  t: GeoTime
  /** Both globe raster sources (docs/GLOBE.md §4.1, G7): PaleoDEM (0-540 Ma) and, when
   *  published, Merdith et al. 2021's stylised continents (540-1000 Ma) — `null` when the
   *  latter is unusable, in which case `Globe` shows the "geography unknown" regime there
   *  instead of faking continents (`regimeEventsWithRasterFallback`). */
  rasterLayers: GlobeRasterLayers
  assetBase: string
  /** `globe-regimes`' full, unfiltered event list (docs/GLOBE.md §6, G8) — `[]` when that
   *  layer isn't published. Raw, not a `Layer<EventsValue>.sample(t)` slice: the regime
   *  crossfade (`effects/regimes.ts`) needs to see a regime's neighbour before `t` enters it. */
  regimeEvents: readonly TimelineEvent[]
  /** `events-core`'s full event list (`Manifest.events`) — read for the globe effects it
   *  carries: Snowball Earth's `ice-shell`, K-Pg's `impact-winter`, the Moon-forming impact's
   *  `giant-impact` (docs/GLOBE.md §5.3, §6). */
  effectEvents: readonly TimelineEvent[]
  expanded: boolean
  onToggleExpand: () => void
}

export function Globe({ t, rasterLayers, assetBase, regimeEvents, effectEvents, expanded, onToggleExpand }: GlobeProps) {
  const blend = useMemo(() => globeMultiBlendAt(rasterLayers, t, assetBase), [rasterLayers, t, assetBase])
  const domain = globeUniforms(blend)
  const direction = useTravelDirection(t)
  const preloadUrls = useMemo(
    () => globeMultiPreloadUrls(rasterLayers, t, direction, PRELOAD_WINDOW, assetBase),
    [rasterLayers, t, direction, assetBase],
  )
  const pair = useGlobeTexturePair(blend, preloadUrls)
  // Gates the shader's textured look: even in-domain, don't show data until the first pair
  // has actually loaded. Distinct from `domain.hasData`, which alone decides the raster
  // fallback caption below — that must reflect the *domain*, not load state, or it would
  // falsely claim "no reconstruction" while in-domain textures are still in flight.
  const showTexture = domain.hasData && pair.texturesReady
  const mix = showTexture ? pair.mix : 0

  // docs/GLOBE.md G7's fallback rule: when Merdith data is unusable, 540-1000 Ma gets the same
  // "geography unknown" regime look that already covers 1000 Ma and older, not fake continents.
  const effectiveRegimeEvents = useMemo(
    () => regimeEventsWithRasterFallback(regimeEvents, rasterLayers.neoproterozoic !== null),
    [regimeEvents, rasterLayers.neoproterozoic],
  )
  const fallbackCaption = useMemo(() => globeMultiCaptionFor(rasterLayers, t), [rasterLayers, t])
  const effects = useGlobeEffects(t, effectiveRegimeEvents, effectEvents, fallbackCaption)
  const caption = effects.caption

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
          <GlobeSphere
            beforeTex={pair.beforeTex}
            afterTex={pair.afterTex}
            mix={mix}
            hasData={showTexture}
            effects={effects.uniforms}
          />
          <AtmosphereRim />
          <OrbitControls enableZoom={expanded} enablePan={false} enableRotate={expanded} rotateSpeed={0.6} />
        </Canvas>

        {caption !== '' && (
          <div className={styles.caption} aria-live="polite">
            {caption}
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

/** Which way `t` last moved, remembered across renders so preloading keeps looking ahead
 *  after playback pauses. Playback runs from the past towards the present by default. */
function useTravelDirection(t: GeoTime): TravelDirection {
  const lastRef = useRef<{ t: GeoTime; direction: TravelDirection }>({ t, direction: 'toPresent' })
  const direction = travelDirection(lastRef.current.t, t, lastRef.current.direction)
  useEffect(() => {
    lastRef.current = { t, direction }
  })
  return direction
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
  /** docs/GLOBE.md G6/G8: the pre-1 Ga regime blend, ice shell and impact/giant-impact
   *  overlays resolved by `web/src/globe/effects`, in exactly the shape `shaders.ts`'s new
   *  uniforms want. */
  effects: GlobeEffectUniforms
}

/** `uImpactFlashAnchorUv`'s value when no anchored effect is active (`effects.impactFlash` is
 *  then 0, so the shader's flash term is zeroed regardless of where this points). */
const NO_ANCHOR_UV: [number, number] = [0, 0]

function GlobeSphere({ beforeTex, afterTex, mix, hasData, effects }: GlobeSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  // Wall-clock seconds, not t (shaders.ts's uTime doc comment) — drives the magma-ocean crack
  // shimmer and water-world steam drift, the same kind of non-informational motion as the
  // sphere's own auto-rotate below.
  const clockRef = useRef(0)

  const uniforms = useMemo(
    () => ({
      uBefore: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uAfter: { value: PLACEHOLDER_TEXTURE as THREE.Texture },
      uMix: { value: 0 },
      uHasData: { value: 0 },
      uRegimeWeights: { value: [0, 0, 0, 0] },
      uIceShell: { value: 0 },
      uImpactWinterVeil: { value: 0 },
      uImpactFlash: { value: 0 },
      uImpactFlashAnchorUv: { value: NO_ANCHOR_UV },
      uGiantImpactFlash: { value: 0 },
      uTime: { value: 0 },
    }),
    [],
  )

  useFrame((_state, delta) => {
    const mesh = meshRef.current
    if (mesh !== null) mesh.rotation.y += delta * AUTO_ROTATE_RADIANS_PER_SECOND
    clockRef.current += delta
    uniforms.uTime.value = clockRef.current
  })

  const { regimeWeights, impactFlashAnchorUv } = effects
  const anchorUv = impactFlashAnchorUv !== null ? [impactFlashAnchorUv.u, impactFlashAnchorUv.v] : NO_ANCHOR_UV

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
        uniforms-uRegimeWeights-value={[
          regimeWeights.magmaOcean,
          regimeWeights.waterWorld,
          regimeWeights.archean,
          regimeWeights.unknownGeography,
        ]}
        uniforms-uIceShell-value={effects.iceShell}
        uniforms-uImpactWinterVeil-value={effects.impactWinterVeil}
        uniforms-uImpactFlash-value={effects.impactFlash}
        uniforms-uImpactFlashAnchorUv-value={anchorUv}
        uniforms-uGiantImpactFlash-value={effects.giantImpactFlash}
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
