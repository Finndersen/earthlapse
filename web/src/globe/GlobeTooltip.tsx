'use client'

/**
 * The one tooltip the human-civilisation layer has — shared by arrival arcs, inhabited markers
 * and city markers, not three parallel mechanisms. It is also the one hit-test: everything the
 * layer draws registers itself as a `GlobeHitCandidate` (a marker registers a point, an arc its
 * polyline) and `useGlobeHitTest` resolves a pointer position against all of them at once.
 *
 * **Why screen-space hit-testing rather than three.js raycasting.** Every drawable in this layer
 * computes its position on the GPU from an `aLonLat` attribute through `projection.ts`'s GLSL
 * twin — none of them has a `position` attribute for a raycaster to intersect, and giving them
 * one would mean rebuilding real geometry on the CPU every frame of the unfold tween. Projecting
 * a few hundred candidate points to screen space on each pointer move instead costs nothing
 * (it happens on pointer moves, not on frames), needs no second copy of the geometry, and works
 * identically on the orb, on the expanded sphere and on the unfolded map.
 *
 * **Accessible by not getting in the way.** The tooltip is inert: `pointer-events: none`, nothing
 * focusable inside it, no focus moved and no focus trapped. It also carries `role="status"` with
 * a polite live region, so a screen-reader user hears what a sighted user is pointing at rather
 * than the tooltip being purely visual. Keyboard interaction elsewhere on the page is untouched.
 */

import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'

import type { GlobeEffectAnchor } from '@/types/layer'

import { sphereMarkerVisibility } from './arcs'
import styles from './Globe.module.css'
import { unfoldedLiftedPosition } from './projection'

export type GlobeHitKind = 'arrival' | 'inhabited' | 'city'

/** What the tooltip says, and what the rest of the layer keys its sympathetic highlights off. */
export interface GlobeHitTarget {
  kind: GlobeHitKind
  /** Unique across every candidate — `${kind}:${id}`-style ids are the caller's job. */
  id: string
  /** The events-core event this target belongs to, for an arrival or an inhabited marker.
   *  `null` for a city, which is `FeatureSet` data with no event of its own. */
  eventId: string | null
  title: string
  description: string
  /** Already formatted through `@/timeline`'s own wording by the caller — this component never
   *  formats a date itself, so the globe can't drift from the rest of the UI. */
  dateRange: string
  /** Where the tooltip points. */
  anchor: GlobeEffectAnchor
}

export interface GlobeHitCandidate {
  /**
   * Builds this candidate's full `GlobeHitTarget` — title/description/dateRange included. Called
   * at most once per candidate, only for the single candidate `pickCandidate` resolves as the
   * winner, so the caller is free to do real formatting work here (`HumanCivilisation.tsx`'s
   * `cityTarget`/`arrivalTarget`) without paying for it on every one of a few hundred candidates
   * built each frame — the hit test itself only ever touches `points`/`tolerancePx`/the lifts.
   */
  content: () => GlobeHitTarget
  /** Screen-space test points: one for a marker, the whole polyline for an arc. */
  points: readonly GlobeEffectAnchor[]
  /** How near, in CSS pixels, the pointer must come. */
  tolerancePx: number
  /** How far the candidate sits above the sphere — the same lift its own renderer applies, so
   *  the hit test and the pixels agree. */
  sphereLift: number
  mapLift: number
}

/** Pointer movement, in CSS pixels, under which a touch press still counts as a tap rather than
 *  a drag of the globe. Mirrors `orbGesture.ts`'s own threshold for the same gesture question. */
const TAP_SLOP_PX = 8

const scratchWorld = new THREE.Vector3()
const scratchLocal = new THREE.Vector3()

interface Projected {
  x: number
  y: number
  visible: boolean
}

/** Exported for `GlobeTooltip.test.ts`: `pickCandidate`'s own scoring is the one hit-test this
 *  layer has, and it is worth pinning against real candidate data (a real arc's real geometry, a
 *  real city's real position) rather than only ever exercised indirectly through a browser. */
export function projectAnchor(
  anchor: GlobeEffectAnchor,
  candidate: GlobeHitCandidate,
  unfold: number,
  radius: number,
  group: THREE.Object3D,
  camera: THREE.Camera,
  width: number,
  height: number,
  out: Projected,
): Projected {
  const [x, y, z] = unfoldedLiftedPosition(anchor, unfold, radius, candidate.sphereLift, candidate.mapLift)
  scratchLocal.set(x, y, z)
  group.localToWorld(scratchWorld.copy(scratchLocal))
  // The limb test before projection, not after: a point on the far side still projects to a
  // perfectly plausible screen position, so without this a pointer over the Atlantic would hit
  // an arc drawn on the hidden side of the globe.
  const facing =
    unfold >= 0.5
      ? 1
      : sphereMarkerVisibility(
          [scratchWorld.x, scratchWorld.y, scratchWorld.z],
          [camera.position.x, camera.position.y, camera.position.z],
          radius,
        )
  scratchWorld.project(camera)
  out.x = (scratchWorld.x * 0.5 + 0.5) * width
  out.y = (-scratchWorld.y * 0.5 + 0.5) * height
  out.visible = facing > 0.5 && scratchWorld.z <= 1
  return out
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const f = lengthSquared > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared)) : 0
  const cx = ax + dx * f
  const cy = ay + dy * f
  return Math.hypot(px - cx, py - cy)
}

/**
 * The nearest candidate to `(pointerX, pointerY)` within its own tolerance, or `null`. A
 * candidate's score is its screen distance divided by its tolerance, so a small city dot and a
 * thin arc compete on "how close did the pointer come, relative to how close it had to come"
 * rather than on raw pixels — which is what makes a 2px dot winnable at all next to an arc whose
 * whole length is a target.
 */
export function pickCandidate(
  candidates: readonly GlobeHitCandidate[],
  pointerX: number,
  pointerY: number,
  unfold: number,
  radius: number,
  group: THREE.Object3D,
  camera: THREE.Camera,
  width: number,
  height: number,
): GlobeHitTarget | null {
  let best: GlobeHitCandidate | null = null
  let bestScore = 1
  const current: Projected = { x: 0, y: 0, visible: false }
  const previous: Projected = { x: 0, y: 0, visible: false }

  for (const candidate of candidates) {
    let nearest = Infinity
    let hasPrevious = false
    for (const anchor of candidate.points) {
      projectAnchor(anchor, candidate, unfold, radius, group, camera, width, height, current)
      if (current.visible) {
        const pointDistance = Math.hypot(pointerX - current.x, pointerY - current.y)
        if (pointDistance < nearest) nearest = pointDistance
        if (hasPrevious && previous.visible) {
          const segment = distanceToSegment(pointerX, pointerY, previous.x, previous.y, current.x, current.y)
          if (segment < nearest) nearest = segment
        }
      }
      previous.x = current.x
      previous.y = current.y
      previous.visible = current.visible
      hasPrevious = true
    }
    const score = nearest / candidate.tolerancePx
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }
  // The only place any candidate's content is actually built — once, for the single winner, and
  // only because a pointer event (not an animation frame) called this function at all.
  return best?.content() ?? null
}

/** Whether two hit targets are the "same" for the purpose of bailing out of a `setState` — by id,
 *  not object reference, since `candidatesRef` can rebuild with a fresh target object for a
 *  target the pointer hasn't actually left (a `t` change during playback). Exported for
 *  `GlobeTooltip.test.ts`. */
export function sameHitTarget(a: GlobeHitTarget | null, b: GlobeHitTarget | null): boolean {
  return (a?.id ?? null) === (b?.id ?? null)
}

export interface GlobeHitTestOptions {
  /** Read fresh on every pointer event — the caller keeps it in a ref so rebuilding the
   *  candidate list every render costs nothing but an assignment. */
  candidatesRef: MutableRefObject<readonly GlobeHitCandidate[]>
  unfold: number
  radius: number
  /** The `<group>` the candidates' positions are expressed in — `Globe.tsx`'s rotating group, so
   *  the auto-rotate and the scene-location ease are already folded in. */
  groupRef: MutableRefObject<THREE.Group | null>
  enabled: boolean
  /** Set true for as long as a touch press landed on a target, so the orb's own tap-to-expand
   *  gesture can stand down and let the tap open a tooltip instead. */
  touchHitRef: MutableRefObject<boolean>
}

/**
 * Hover on a pointer device, tap on a touch one. A touch tap that lands on nothing clears the
 * tooltip, which is what makes "tap elsewhere to dismiss" work without a backdrop element.
 */
export function useGlobeHitTest({
  candidatesRef,
  unfold,
  radius,
  groupRef,
  enabled,
  touchHitRef,
}: GlobeHitTestOptions): GlobeHitTarget | null {
  const { camera, gl, size } = useThree()
  const [target, setTarget] = useState<GlobeHitTarget | null>(null)
  // The live values the DOM listeners below read — re-subscribing the listeners on every frame
  // of playback (which is what a dependency on `unfold`/`size` would mean) is what this avoids.
  const frameRef = useRef({ unfold, radius, width: size.width, height: size.height })
  frameRef.current = { unfold, radius, width: size.width, height: size.height }

  useEffect(() => {
    if (!enabled) {
      setTarget(null)
      return undefined
    }
    const canvas = gl.domElement
    const pressStart = { x: 0, y: 0, touch: false }

    const resolve = (clientX: number, clientY: number): GlobeHitTarget | null => {
      const group = groupRef.current
      if (group === null) return null
      const rect = canvas.getBoundingClientRect()
      const { unfold: u, radius: r, width, height } = frameRef.current
      return pickCandidate(candidatesRef.current, clientX - rect.left, clientY - rect.top, u, r, group, camera, width, height)
    }

    // Bails without a re-render when the resolved target is the same one already shown — by id,
    // not object reference, since `candidatesRef` can rebuild with fresh target objects (a `t`
    // change during playback) for a target the pointer hasn't actually left. A drag or a fast
    // sweep across empty space between candidates would otherwise re-render this layer's whole
    // subtree (and, upstream, force `HumanCivilisation.tsx`'s marker set to be treated as changed)
    // on every single pointermove rather than only on an actual change of hover target.
    const applyTarget = (next: GlobeHitTarget | null): void => {
      setTarget((prev) => (sameHitTarget(prev, next) ? prev : next))
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return
      applyTarget(resolve(event.clientX, event.clientY))
    }
    const onPointerLeave = (): void => applyTarget(null)
    const onPointerDown = (event: PointerEvent): void => {
      pressStart.x = event.clientX
      pressStart.y = event.clientY
      pressStart.touch = event.pointerType === 'touch'
      if (pressStart.touch) touchHitRef.current = resolve(event.clientX, event.clientY) !== null
    }
    const onPointerUp = (event: PointerEvent): void => {
      if (!pressStart.touch) return
      const moved = Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y)
      if (moved <= TAP_SLOP_PX) applyTarget(resolve(event.clientX, event.clientY))
      touchHitRef.current = false
    }

    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    return () => {
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
    }
  }, [camera, gl, enabled, candidatesRef, groupRef, touchHitRef])

  return target
}

/** Kept in step with `.tooltip`'s own `max-width` plus its padding and border
 *  (`Globe.module.css`) — the width the clamp below has to reserve. A measured width would be a
 *  frame late on the first show, which is exactly when the clamp matters most. */
const TOOLTIP_WIDTH_PX = 240
/** The tooltip's own `translate(12px, -50%)` offset from the anchor, and the gap it keeps from
 *  the panel's edges. */
const TOOLTIP_OFFSET_PX = 12
const TOOLTIP_EDGE_PAD_PX = 8
/** Half the tallest tooltip this can produce (title + date + three clamped description lines). */
const TOOLTIP_HALF_HEIGHT_PX = 52

const positionScratch = new THREE.Vector3()

/**
 * drei's own default projection, plus a clamp into the canvas. Without the clamp a tooltip
 * anchored near the panel's right or bottom edge is cut off by the panel's own rounded-corner
 * clipping — browser-verified on the map's eastern edge, where the Sahul marker's tooltip lost
 * half its text. Clamping the *container* rather than flipping the offset keeps the pointer
 * relationship stable (the tooltip never jumps sides as the globe rotates a target past the edge).
 */
function clampedPosition(el: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }): [number, number] {
  positionScratch.setFromMatrixPosition(el.matrixWorld).project(camera)
  const x = positionScratch.x * (size.width / 2) + size.width / 2
  const y = -(positionScratch.y * (size.height / 2)) + size.height / 2
  const maxX = size.width - TOOLTIP_WIDTH_PX - TOOLTIP_OFFSET_PX - TOOLTIP_EDGE_PAD_PX
  const maxY = size.height - TOOLTIP_HALF_HEIGHT_PX - TOOLTIP_EDGE_PAD_PX
  return [
    Math.min(Math.max(x, TOOLTIP_EDGE_PAD_PX), Math.max(TOOLTIP_EDGE_PAD_PX, maxX)),
    Math.min(Math.max(y, TOOLTIP_HALF_HEIGHT_PX + TOOLTIP_EDGE_PAD_PX), Math.max(TOOLTIP_HALF_HEIGHT_PX, maxY)),
  ]
}

export interface GlobeTooltipProps {
  target: GlobeHitTarget | null
  unfold: number
  radius: number
  sphereLift: number
  mapLift: number
}

/**
 * Drawn at the target's own position through drei's `Html`, so it tracks the globe as it rotates
 * and as it unfolds without this component re-deriving a screen position every frame. Rendered
 * as a child of the rotating group by the caller, for the same reason every other overlay is.
 */
export function GlobeTooltip({ target, unfold, radius, sphereLift, mapLift }: GlobeTooltipProps) {
  if (target === null) return null
  const [x, y, z] = unfoldedLiftedPosition(target.anchor, unfold, radius, sphereLift, mapLift)
  return (
    <Html position={[x, y, z]} calculatePosition={clampedPosition} pointerEvents="none" zIndexRange={[40, 0]} style={{ pointerEvents: 'none' }}>
      <div className={styles.tooltip} role="status" aria-live="polite" data-testid="globe-tooltip">
        <p className={styles.tooltipTitle}>{target.title}</p>
        <p className={styles.tooltipDate}>{target.dateRange}</p>
        <p className={styles.tooltipDescription}>{target.description}</p>
      </div>
    </Html>
  )
}
