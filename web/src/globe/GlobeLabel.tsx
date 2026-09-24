'use client'

/**
 * A small screen-space name tag pinned to a lat/lon on the globe, shared by the transient city
 * tags (`HumanCivilisation.tsx`) and the empire lineage labels (`EmpireLabels.tsx`).
 *
 * Positioned like `GlobeTooltip.tsx`'s tooltip — drei's `Html` at the anchor's
 * `unfoldedLiftedPosition`, so it tracks rotation and the sphere/map unfold — but with no edge
 * clamp: these are decorative and drawn several at once. A city tag is styled inline to match
 * `.tooltip` (mono HUD font, near-black translucent chip) so it reads as the same family; an
 * empire label is bare text with a halo, since it sits over the territory it names.
 *
 * Visibility is about the camera, not the clock, so each tag runs its own `useFrame`: camera
 * drag and auto-rotate change it without `t` changing or the owner re-rendering. The div's
 * `opacity` is written through a ref rather than React state for the same reason.
 */

import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import * as THREE from 'three'

import { sphereMarkerVisibility } from './arcs'
import { MARKER_MAP_LIFT, MARKER_SPHERE_LIFT } from './humanStyle'
import { unfoldedLiftedPosition } from './projection'

const LABEL_TEXT_STYLE: CSSProperties = {
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
  fontFamily: 'var(--hud-mono, ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace)',
  color: 'var(--hud-ink, #efe9dc)',
  opacity: 0,
}

const LABEL_CHIP_STYLE: CSSProperties = {
  ...LABEL_TEXT_STYLE,
  letterSpacing: '0.03em',
  background: 'rgba(3, 4, 6, 0.78)',
  border: '1px solid var(--hud-hairline, rgba(239, 233, 220, 0.18))',
  borderRadius: 4,
}

/** A city tag sits just right of its marker dot. */
export const CITY_LABEL_STYLE: CSSProperties = {
  ...LABEL_CHIP_STYLE,
  transform: 'translate(7px, -50%)',
  fontSize: 9,
  padding: '2px 5px',
}

const EMPIRE_LABEL_FONT_PX = 9
const EMPIRE_LABEL_LINE_PX = 11
const EMPIRE_LABEL_TRACKING_EM = 0.14
const EMPIRE_LABEL_TICK_PX = 5
const EMPIRE_LABEL_TICK_GAP_PX = 4

/** An empire label's measurements, for decluttering without reading the DOM. */
export const EMPIRE_LABEL_BOX = {
  /** One monospaced character (0.6em) plus the letter spacing. */
  advancePx: EMPIRE_LABEL_FONT_PX * (0.6 + EMPIRE_LABEL_TRACKING_EM),
  /** The colour tick and its gap before the text. */
  chromeWidthPx: EMPIRE_LABEL_TICK_PX + EMPIRE_LABEL_TICK_GAP_PX,
  heightPx: EMPIRE_LABEL_LINE_PX,
} as const

/** An empire label: small semibold tracked capitals centred on the territory's anchor, no backing, legible
 *  over any terrain through a dark halo. Its tick (`empireLabelTickStyle`) carries the lineage's
 *  colour so the name ties to its outline. */
export const EMPIRE_LABEL_STYLE: CSSProperties = {
  ...LABEL_TEXT_STYLE,
  display: 'flex',
  alignItems: 'center',
  gap: EMPIRE_LABEL_TICK_GAP_PX,
  transform: 'translate(-50%, -50%)',
  fontSize: EMPIRE_LABEL_FONT_PX,
  lineHeight: `${EMPIRE_LABEL_LINE_PX}px`,
  fontWeight: 600,
  letterSpacing: `${EMPIRE_LABEL_TRACKING_EM}em`,
  textTransform: 'uppercase',
  textShadow: '0 0 1px rgba(3, 4, 6, 1), 0 0 2px rgba(3, 4, 6, 0.95), 0 0 4px rgba(3, 4, 6, 0.85), 0 0 8px rgba(3, 4, 6, 0.6)',
}

export function empireLabelTickStyle(accent: string): CSSProperties {
  return {
    flex: 'none',
    width: EMPIRE_LABEL_TICK_PX,
    height: EMPIRE_LABEL_TICK_PX,
    borderRadius: '50%',
    background: accent,
    boxShadow: '0 0 0 1px rgba(3, 4, 6, 0.7)',
  }
}

/**
 * The label's draw-alpha multiplier for whether its anchor can be seen right now. Pure (plain
 * tuples, no `THREE` types) so it is unit-testable without a canvas.
 *
 * - **Off-screen** (`ndc` outside `[-1, 1]` in x/y, or behind the camera — `ndc[2] > 1`): 0. A
 *   label is never dragged back into view the way the pointer-following tooltip is — an
 *   unrequested label at the screen edge would point at nothing real.
 * - **Round the back of the sphere** (globe mode only — `unfold >= 0.5` skips this, as
 *   `GlobeTooltip.tsx`'s `projectAnchor` does): `sphereMarkerVisibility`'s smooth limb fade.
 */
export function cityLabelVisibility(
  worldPosition: readonly [number, number, number],
  cameraPosition: readonly [number, number, number],
  radius: number,
  unfold: number,
  ndc: readonly [number, number, number],
): number {
  const onScreen = Math.abs(ndc[0]) <= 1 && Math.abs(ndc[1]) <= 1 && ndc[2] <= 1
  if (!onScreen) return 0
  return unfold >= 0.5 ? 1 : sphereMarkerVisibility(worldPosition, cameraPosition, radius)
}

const labelScratchLocal = new THREE.Vector3()
const labelScratchWorld = new THREE.Vector3()

export interface GlobeLabelProps {
  text: string
  lat: number
  lon: number
  /** Multiplied by the camera visibility each frame. */
  opacity: number
  unfold: number
  radius: number
  /** The owning group, whose transform places the label's local position in the world. */
  groupRef: MutableRefObject<THREE.Group | null>
  style: CSSProperties
  /** Drawn before the text, e.g. an empire label's colour tick. */
  tickStyle?: CSSProperties
  /** Moves the sphere's limb fade this far inward, in `sphereMarkerVisibility`'s cosine units, so
   *  the label is gone before its anchor reaches the limb. */
  limbInset?: number
}

export function GlobeLabel({ text, lat, lon, opacity, unfold, radius, groupRef, style, tickStyle, limbInset = 0 }: GlobeLabelProps) {
  const elementRef = useRef<HTMLDivElement>(null)
  const { camera } = useThree()
  const [x, y, z] = unfoldedLiftedPosition({ lat, lon }, unfold, radius, MARKER_SPHERE_LIFT, MARKER_MAP_LIFT)

  useFrame(() => {
    const group = groupRef.current
    const element = elementRef.current
    if (group === null || element === null) return
    labelScratchLocal.set(x, y, z)
    group.localToWorld(labelScratchWorld.copy(labelScratchLocal))
    const worldPosition: [number, number, number] = [labelScratchWorld.x, labelScratchWorld.y, labelScratchWorld.z]
    const cameraPosition: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z]
    // `sphereMarkerVisibility`'s horizon sits at cos = radius / cameraDistance, so widening the
    // radius by `limbInset * cameraDistance` raises it by exactly `limbInset`.
    const fadeRadius = radius + limbInset * camera.position.length()
    // `.project` mutates in place; `worldPosition` is already captured, so reusing the scratch
    // vector for the NDC projection is safe.
    labelScratchWorld.project(camera)
    const ndc: [number, number, number] = [labelScratchWorld.x, labelScratchWorld.y, labelScratchWorld.z]
    element.style.opacity = String(opacity * cityLabelVisibility(worldPosition, cameraPosition, fadeRadius, unfold, ndc))
  })

  return (
    <Html position={[x, y, z]} pointerEvents="none" zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div ref={elementRef} style={style} data-globe-label="">
        {tickStyle !== undefined && <span aria-hidden="true" style={tickStyle} />}
        {text}
      </div>
    </Html>
  )
}

/** One "zoom step" for `useZoomBucket`, as a fraction change in camera distance (`Math.log(1.15)`
 *  ~ 15%) — loose enough to noticeably ease a declutter as a viewer zooms in, tight enough to damp
 *  sub-percent camera jitter that would otherwise flip a borderline item in and out. */
const ZOOM_BUCKET_STEP = Math.log(1.15)

/**
 * Camera distance from the world origin, quantised into `ZOOM_BUCKET_STEP`-sized steps, updating
 * only when the viewer crosses into a new step. Read every frame (`OrbitControls` mutates the
 * camera directly with no render-triggering signal of its own), but only triggers a `setState` on
 * a bucket crossing. Local-space positions are rotation/pan invariant, so only the
 * local-to-screen-pixel conversion (which scales with 1/distance) needs the camera at all.
 */
function useZoomBucket(camera: THREE.Camera, active: boolean): number {
  const bucketRef = useRef(0)
  const [bucket, setBucket] = useState(0)
  useFrame(() => {
    if (!active) return
    const distance = camera.position.length()
    if (!(distance > 0)) return
    const next = Math.round(Math.log(distance) / ZOOM_BUCKET_STEP)
    if (next !== bucketRef.current) {
      bucketRef.current = next
      setBucket(next)
    }
  })
  return Math.exp(bucket * ZOOM_BUCKET_STEP)
}

/**
 * `separationPx` CSS pixels as a distance in the globe's unit-radius local space, via the
 * perspective scale at the current (bucketed) camera distance — the space `cities.ts`'s
 * `declutterCities` compares positions in.
 */
export function useScreenSeparation(separationPx: number, active: boolean): number {
  const { camera, size } = useThree()
  const zoomDistance = useZoomBucket(camera, active)
  return useMemo(() => {
    const fovYRadians = (((camera as THREE.PerspectiveCamera).fov ?? 40) * Math.PI) / 180
    const pixelsPerWorldUnit = size.height / (2 * zoomDistance * Math.tan(fovYRadians / 2))
    return pixelsPerWorldUnit > 0 ? separationPx / pixelsPerWorldUnit : 0
  }, [camera, size.height, zoomDistance, separationPx])
}
