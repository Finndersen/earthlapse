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
 * Empire territories join the same hit test last: after every mark misses, the pointer is
 * inverse-projected to lon/lat (`pointerLonLat`) and tested against the active polygons, so the
 * small marks drawn on top of a territory keep winning over the area underneath them.
 * Opening an event's full detail is a click (or second tap) on the drawn target itself
 * (`bindGlobeHitTest`), never on the tooltip, so the tooltip can stay inert; its `hint` line only
 * says so. The same detail is reachable by keyboard through the event feed and browser.
 */

import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'

import type { GlobeEffectAnchor } from '@/types/layer'

import { sphereMarkerVisibility } from './arcs'
import styles from './Globe.module.css'
import { ORB_CLICK_DRAG_THRESHOLD_PX } from './orbGesture'
import { lonLatToMap, mapToLonLat, sphereToLonLat, unfoldedLiftedPosition } from './projection'

export type GlobeHitKind = 'arrival' | 'inhabited' | 'city' | 'empire'

/** What the tooltip says, and what the rest of the layer keys its sympathetic highlights off. */
export interface GlobeHitTarget {
  kind: GlobeHitKind
  /** Unique across every candidate — `${kind}:${id}`-style ids are the caller's job. */
  id: string
  /** The events-core event this target belongs to, for an arrival or an inhabited marker.
   *  `null` for a city, which is `FeatureSet` data with no event of its own. */
  eventId: string | null
  /** The empire lineage an `empire` target names; activating it opens that lineage's panel. */
  lineage?: string
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

/** The first stage's target, in order: each stage runs only when every earlier one missed. */
function resolveGlobeHit(stages: readonly (() => GlobeHitTarget | null)[]): GlobeHitTarget | null {
  for (const stage of stages) {
    const hit = stage()
    if (hit !== null) return hit
  }
  return null
}

/** How close to either end of the unfold tween the surface hit test still answers; in between,
 *  the surface is neither the sphere nor the plane and no lon/lat is reported. */
const SURFACE_HIT_UNFOLD_EPSILON = 0.02
/** How far, in map units at `radius = 1`, a plane hit may sit from its own reprojection before it
 *  counts as off the map's curved outline (`mapToLonLat` clamps rather than refusing). */
const MAP_OUTLINE_TOLERANCE = 1e-3

const surfaceRaycaster = new THREE.Raycaster()
const surfaceNdc = new THREE.Vector2()
const surfaceInverse = new THREE.Matrix4()
const surfaceRay = new THREE.Ray()
const surfaceHit = new THREE.Vector3()
const surfaceSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1)
const surfacePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -1)

/**
 * The lon/lat on the globe's surface under a canvas-space pointer, or `null` off the body or
 * mid-unfold. The camera ray is taken into `group`'s local space, so the rotation and any
 * scene-location ease are folded in, and met with the sphere of `radius` (globe) or the map plane
 * at `z = radius` (`projection.ts`'s flat endpoint) — the same two shapes `GlobeSphere`'s
 * analytic raycast uses.
 */
export function pointerLonLat(
  pointerX: number,
  pointerY: number,
  width: number,
  height: number,
  unfold: number,
  radius: number,
  group: THREE.Object3D,
  camera: THREE.Camera,
): GlobeEffectAnchor | null {
  const onSphere = unfold <= SURFACE_HIT_UNFOLD_EPSILON
  const onMap = unfold >= 1 - SURFACE_HIT_UNFOLD_EPSILON
  if (!onSphere && !onMap) return null
  surfaceNdc.set((pointerX / width) * 2 - 1, -(pointerY / height) * 2 + 1)
  surfaceRaycaster.setFromCamera(surfaceNdc, camera)
  surfaceInverse.copy(group.matrixWorld).invert()
  surfaceRay.copy(surfaceRaycaster.ray).applyMatrix4(surfaceInverse)
  if (onSphere) {
    surfaceSphere.radius = radius
    if (surfaceRay.intersectSphere(surfaceSphere, surfaceHit) === null) return null
    return sphereToLonLat([surfaceHit.x, surfaceHit.y, surfaceHit.z])
  }
  surfacePlane.constant = -radius
  if (surfaceRay.intersectPlane(surfacePlane, surfaceHit) === null) return null
  const point = mapToLonLat(surfaceHit.x, surfaceHit.y, radius)
  const [x, y] = lonLatToMap(point, radius)
  if (Math.hypot(x - surfaceHit.x, y - surfaceHit.y) > MAP_OUTLINE_TOLERANCE * radius) return null
  return point
}

/** Whether two hit targets are the "same" for the purpose of bailing out of a `setState` — by id,
 *  not object reference, since `candidatesRef` can rebuild with a fresh target object for a
 *  target the pointer hasn't actually left (a `t` change during playback). Exported for
 *  `GlobeTooltip.test.ts`. */
export function sameHitTarget(a: GlobeHitTarget | null, b: GlobeHitTarget | null): boolean {
  return (a?.id ?? null) === (b?.id ?? null)
}

export interface GlobeHitTestBindings {
  /** The target under a client-space point, or `null`. */
  resolve: (clientX: number, clientY: number) => GlobeHitTarget | null
  /** Called when the shown target changes (by id, or between hover and touch), with whether a
   *  touch tap produced it. */
  onChange: (target: GlobeHitTarget | null, viaTouch: boolean) => void
  /** Set true for as long as a touch press landed on a target, so the orb's own tap-to-expand
   *  gesture can stand down and let the tap open a tooltip instead. */
  touchHitRef: MutableRefObject<boolean>
  /** Opens an event's detail, read at click time; `null` while activation is off (the
   *  minimised orb, whose click expands it instead). */
  activateRef: MutableRefObject<((eventId: string) => void) | null>
  /** Opens an empire lineage's panel from an `empire` target, read at click time like
   *  `activateRef`. */
  activateEmpireRef?: MutableRefObject<((lineage: string) => void) | null>
}

/**
 * The hit-test's DOM gestures on `canvas`: hover on a pointer device, tap on a touch one. A touch
 * tap that lands on nothing clears the tooltip, which is what makes "tap elsewhere to dismiss"
 * work without a backdrop element.
 *
 * **Activation.** A mouse click on a target that belongs to an event opens that event; on touch
 * the first tap only shows the tooltip and a second tap on the *same* target opens it, so a tap
 * never jumps straight past the preview. Activation runs on `click`, not `pointerup`: a panel
 * mounted on `pointerup` would sit under the finger by the time the browser dispatches the tap's
 * own `click`, which would land on the panel's backdrop and close it again. An activating click
 * stops propagating at the canvas, so the canvas container (r3f's `onPointerMissed`, the
 * expanded view's backdrop-click collapse) never also reads it as a click on empty space.
 * Returns the unbind function.
 */
export function bindGlobeHitTest(canvas: HTMLElement, bindings: GlobeHitTestBindings): () => void {
  const { resolve, onChange, touchHitRef, activateRef, activateEmpireRef } = bindings
  const press = { x: 0, y: 0, touch: false }
  let shown: GlobeHitTarget | null = null
  let shownViaTouch = false
  // What was showing when the current press began — a touch tap activates only a target that
  // was already on screen before the finger came down.
  let shownAtPress: GlobeHitTarget | null = null

  const show = (next: GlobeHitTarget | null, viaTouch: boolean): void => {
    if (sameHitTarget(shown, next) && (next === null || shownViaTouch === viaTouch)) return
    shown = next
    shownViaTouch = viaTouch
    onChange(next, viaTouch)
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return
    show(resolve(event.clientX, event.clientY), false)
  }
  // Touch pointers only ever "leave" because the finger lifted, which fires this immediately
  // after `onPointerUp` — not a dismissal gesture. Touch dismissal is `onPointerUp` resolving to
  // nothing (a tap on empty space).
  const onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') return
    show(null, false)
  }
  const onPointerDown = (event: PointerEvent): void => {
    press.x = event.clientX
    press.y = event.clientY
    press.touch = event.pointerType === 'touch'
    shownAtPress = shown
    if (press.touch) touchHitRef.current = resolve(event.clientX, event.clientY) !== null
  }
  const onPointerUp = (event: PointerEvent): void => {
    if (!press.touch) return
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y)
    if (moved <= TAP_SLOP_PX) show(resolve(event.clientX, event.clientY), true)
    touchHitRef.current = false
  }
  // What activating `hit` does, or `null` when it opens nothing.
  const activationOf = (hit: GlobeHitTarget): (() => void) | null => {
    const { lineage, eventId } = hit
    if (lineage !== undefined) {
      const activateEmpire = activateEmpireRef?.current ?? null
      return activateEmpire === null ? null : () => activateEmpire(lineage)
    }
    const activate = activateRef.current
    return activate === null || eventId === null ? null : () => activate(eventId)
  }
  const onClick = (event: MouseEvent): void => {
    if (activateRef.current === null && (activateEmpireRef?.current ?? null) === null) return
    const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y)
    if (moved > (press.touch ? TAP_SLOP_PX : ORB_CLICK_DRAG_THRESHOLD_PX)) return
    const hit = resolve(event.clientX, event.clientY)
    const open = hit === null ? null : activationOf(hit)
    if (open === null) return
    if (press.touch && !sameHitTarget(hit, shownAtPress)) return
    event.stopPropagation()
    open()
  }

  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('click', onClick)
  return () => {
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerleave', onPointerLeave)
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('click', onClick)
  }
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
  touchHitRef: MutableRefObject<boolean>
  /** Opens an event from its target (`bindGlobeHitTest`'s "Activation"); `null` turns it off. */
  onActivate: ((eventId: string) => void) | null
  /** Opens an empire lineage from an `empire` target; `null` or absent turns it off. */
  onActivateEmpire?: ((lineage: string) => void) | null
  /** Resolved only when `candidatesRef` misses: targets that sit under the layer's own marks,
   *  such as empire label anchors. */
  fallbackCandidatesRef?: MutableRefObject<readonly GlobeHitCandidate[]>
  /** Resolved last, against the lon/lat under the pointer (`pointerLonLat`): targets that are
   *  areas of the surface rather than marks on it, such as empire territories. */
  surfaceRef?: MutableRefObject<((point: GlobeEffectAnchor) => GlobeHitTarget | null) | null>
}

export interface GlobeHitState {
  target: GlobeHitTarget | null
  /** Whether a touch tap, rather than a hover, produced `target` — decides the tooltip's hint. */
  viaTouch: boolean
}

const NO_HIT: GlobeHitState = { target: null, viaTouch: false }

/** `bindGlobeHitTest` on the r3f canvas, resolving against the live candidates. */
export function useGlobeHitTest({
  candidatesRef,
  unfold,
  radius,
  groupRef,
  enabled,
  touchHitRef,
  onActivate,
  onActivateEmpire = null,
  fallbackCandidatesRef,
  surfaceRef,
}: GlobeHitTestOptions): GlobeHitState {
  const { camera, gl, size } = useThree()
  const [hit, setHit] = useState<GlobeHitState>(NO_HIT)
  // The live values the DOM listeners read — re-subscribing the listeners on every frame of
  // playback (which is what a dependency on `unfold`/`size` would mean) is what this avoids.
  const frameRef = useRef({ unfold, radius, width: size.width, height: size.height })
  frameRef.current = { unfold, radius, width: size.width, height: size.height }
  const activateRef = useRef(onActivate)
  activateRef.current = onActivate
  const activateEmpireRef = useRef(onActivateEmpire)
  activateEmpireRef.current = onActivateEmpire

  useEffect(() => {
    if (!enabled) {
      setHit(NO_HIT)
      return undefined
    }
    const canvas = gl.domElement
    const resolve = (clientX: number, clientY: number): GlobeHitTarget | null => {
      const group = groupRef.current
      if (group === null) return null
      const rect = canvas.getBoundingClientRect()
      const { unfold: u, radius: r, width, height } = frameRef.current
      const x = clientX - rect.left
      const y = clientY - rect.top
      return resolveGlobeHit([
        () => pickCandidate(candidatesRef.current, x, y, u, r, group, camera, width, height),
        () => (fallbackCandidatesRef === undefined ? null : pickCandidate(fallbackCandidatesRef.current, x, y, u, r, group, camera, width, height)),
        () => {
          const surface = surfaceRef?.current ?? null
          if (surface === null) return null
          const point = pointerLonLat(x, y, width, height, u, r, group, camera)
          return point === null ? null : surface(point)
        },
      ])
    }
    // `bindGlobeHitTest` only reports an id change, so a drag or a sweep across empty space
    // re-renders this layer only when the hover target actually changes.
    return bindGlobeHitTest(canvas, {
      resolve,
      onChange: (target, viaTouch) => setHit(target === null ? NO_HIT : { target, viaTouch }),
      touchHitRef,
      activateRef,
      activateEmpireRef,
    })
  }, [camera, gl, enabled, candidatesRef, fallbackCandidatesRef, surfaceRef, groupRef, touchHitRef])

  return hit
}

/** Kept in step with `.tooltip`'s own `max-width` plus its padding and border
 *  (`Globe.module.css`) — the width the clamp below has to reserve. A measured width would be a
 *  frame late on the first show, which is exactly when the clamp matters most. */
const TOOLTIP_WIDTH_PX = 240
/** The tooltip's own `translate(12px, -50%)` offset from the anchor, and the gap it keeps from
 *  the panel's edges. */
const TOOLTIP_OFFSET_PX = 12
const TOOLTIP_EDGE_PAD_PX = 8
/** Half the tallest tooltip this can produce (title + date + three clamped description lines +
 *  the hint line). */
const TOOLTIP_HALF_HEIGHT_PX = 60

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
  /** A short line under the description saying how to open the full detail, or `null`. */
  hint: string | null
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
export function GlobeTooltip({ target, hint, unfold, radius, sphereLift, mapLift }: GlobeTooltipProps) {
  if (target === null) return null
  const [x, y, z] = unfoldedLiftedPosition(target.anchor, unfold, radius, sphereLift, mapLift)
  // drei orders `Html` by camera distance within its range; starting above `GlobeLabel`'s [20, 0]
  // keeps a nearer label from drawing over the tooltip.
  return (
    <Html position={[x, y, z]} calculatePosition={clampedPosition} pointerEvents="none" zIndexRange={[40, 21]} style={{ pointerEvents: 'none' }}>
      <div className={styles.tooltip} role="status" aria-live="polite" data-testid="globe-tooltip">
        <p className={styles.tooltipTitle}>{target.title}</p>
        <p className={styles.tooltipDate}>{target.dateRange}</p>
        <p className={styles.tooltipDescription}>{target.description}</p>
        {hint !== null && (
          <p className={styles.tooltipHint} data-testid="globe-tooltip-hint">
            {hint}
          </p>
        )}
      </div>
    </Html>
  )
}
