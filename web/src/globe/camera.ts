/**
 * Pure camera-framing math for the expanded globe's map mode (docs/GLOBE.md's ADR-033).
 * No three.js, no React — `Globe.tsx`'s `GlobeCameraControls` is the thin consumer, the same
 * split `globeGeometry.ts` and `blend.ts` use for their own math.
 */

import type { GlobeEffectAnchor } from '@/types/layer'

import { lonLatToMap, sphereToLonLat, unfoldedNormal, unfoldedPosition } from './projection'

/** Perspective distance along the view axis such that a `2*halfWidth` x `2*halfHeight`
 *  rectangle, centred on the origin and facing the camera, exactly fills the viewport at
 *  `aspect` (width/height) and vertical field of view `fovYRadians` — plus `margin` extra
 *  fractional headroom on every side (`0.08` = 8%). Checks both axes and returns whichever
 *  distance the tighter one demands, so the whole rectangle fits "at any aspect (phones
 *  included)": a narrow/tall viewport is height-bound, a wide one width-bound. */
export function fitDistance(halfWidth: number, halfHeight: number, aspect: number, fovYRadians: number, margin: number): number {
  const paddedHalfWidth = halfWidth * (1 + margin)
  const paddedHalfHeight = halfHeight * (1 + margin)
  const halfFovY = fovYRadians / 2
  const distanceForHeight = paddedHalfHeight / Math.tan(halfFovY)
  const halfFovX = Math.atan(Math.tan(halfFovY) * aspect)
  const distanceForWidth = paddedHalfWidth / Math.tan(halfFovX)
  return Math.max(distanceForHeight, distanceForWidth)
}

/**
 * Perspective distance such that a sphere of `radius`, centred on the origin, exactly fills the
 * viewport at `aspect` and vertical field of view `fovYRadians` (whichever axis is tighter) —
 * `fitDistance`'s own sibling for a round silhouette instead of a flat rectangle's. `margin`
 * follows the same convention `fitDistance` uses (extra fractional headroom on the apparent
 * radius, `0.08` = 8%), so the two read as one family and a caller already fitting a flat panel
 * (`MAP_FIT_MARGIN`) can pick a comparable value here without re-deriving what it means.
 *
 * A sphere's own apparent (tangent) radius at distance `d` is the standard perspective-projection
 * result `radius / sqrt(d^2 - radius^2)` — the tangent of the half-angle a viewer actually sees,
 * exactly analogous to `fitDistance`'s own `paddedHalfExtent / tan(halfFov)` for a flat plane.
 * Padding that apparent radius by `margin` and solving for `d` (`tan(halfFov)/(1+margin)` is the
 * padded target tangent, call it `k`; `d = radius * sqrt(1 + 1/k^2)`) gives a closed form with no
 * iteration, the same "cheap enough to call every frame" property `fitDistance` has.
 *
 * Used for `Globe.tsx`'s *expanded* sphere framing only (`SPHERE_FIT_MARGIN`) — the minimised
 * orb keeps its own separate, deliberately loose `CAMERA_DISTANCE` (that framing exists to leave
 * room for the halo glow and read as a small floating object, not to fill the frame; see that
 * constant's own doc comment), so this function is never applied there.
 */
export function sphereFitDistance(radius: number, aspect: number, fovYRadians: number, margin: number): number {
  const halfFovY = fovYRadians / 2
  const halfFovX = Math.atan(Math.tan(halfFovY) * aspect)
  const tightestHalfFov = Math.min(halfFovX, halfFovY)
  const paddedTangent = Math.tan(tightestHalfFov) / (1 + margin)
  return radius * Math.sqrt(1 + 1 / (paddedTangent * paddedTangent))
}

/** Floor on the distance-above-radius terms below, so a camera at or inside `radius` (the sphere
 *  mode zoom range has no `minDistance`) never divides by zero or drives rotateSpeed to/below 0,
 *  which would freeze the drag rather than merely make it imprecise. */
const MIN_DISTANCE_ABOVE_RADIUS_FRACTION = 1e-3

/**
 * The `rotateSpeed` that keeps a one-finger drag tracking the sphere surface under the finger at
 * any camera `distance`. `OrbitControls.rotateLeft` turns the camera by `2*pi*rotateSpeed*deltaPx
 * /element.clientHeight` — no distance term — so a fixed speed sweeps ever more surface as the
 * camera closes in.
 *
 * A rotation of `theta` moves the point nearest the camera by an arc of `radius * theta`, which
 * projects to screen at a rate scaling as `1/(distance - radius)`; the speed needed for 1:1
 * tracking is therefore linear in `(distance - radius)`. The constant of proportionality depends
 * on fov and element height, so rather than derive it, this anchors to a measured-good point:
 * `defaultRotateSpeed` at `defaultDistance`, which it returns exactly.
 *
 * Both distance terms are floored just above `radius`: the ideal speed genuinely tends to 0 at the
 * surface, but 0 would freeze the drag outright rather than merely lose 1:1 tracking.
 */
export function sphereRotateSpeedForDistance(
  distance: number,
  radius: number,
  defaultDistance: number,
  defaultRotateSpeed: number,
): number {
  const distanceAboveRadius = Math.max(distance - radius, radius * MIN_DISTANCE_ABOVE_RADIUS_FRACTION)
  const defaultDistanceAboveRadius = Math.max(defaultDistance - radius, radius * MIN_DISTANCE_ABOVE_RADIUS_FRACTION)
  return (defaultRotateSpeed * distanceAboveRadius) / defaultDistanceAboveRadius
}

function clampAbs(value: number, max: number): number {
  return Math.min(max, Math.max(-max, value))
}

/**
 * The vertical FOV a `subHeightPx`-tall rectangle subtends within a camera whose real vertical
 * FOV (`fovYRadians`) spans the *whole* canvas (`canvasHeightPx`) — i.e. "what FOV would a camera
 * need on its own to make an object exactly fill just this sub-rectangle, at the same distance."
 * Feeding the result into `sphereFitDistance`/`fitDistance` (in place of the camera's real
 * `fovYRadians`) computes the distance that fits an object into that sub-rectangle specifically,
 * while the camera's actual FOV/aspect keep covering the full canvas around it.
 *
 * Exists because `Globe.tsx`'s expanded canvas now fills the whole backdrop (removing the old
 * square clip on zoom — docs/GLOBE.md), but the *default* sphere/map framing must still look the
 * size it did when the canvas was only the chrome-gap-sized panel: `Globe.tsx` measures that
 * panel's live rectangle in the DOM (an invisible reference frame, not the canvas) and passes its
 * height here rather than the canvas's own, now much taller, one. Derived from the standard
 * perspective mapping "screen position is proportional to tan(angle-from-axis)": a sub-rectangle
 * `subHeightPx` tall out of a `canvasHeightPx`-tall canvas subtends `tan(halfFov) =
 * (subHeightPx/canvasHeightPx) * tan(realHalfFov)` — the derivation (and its horizontal
 * counterpart, reproduced for free via `aspect` in the caller) is in `camera.test.ts`.
 */
export function subFrameFovY(fovYRadians: number, subHeightPx: number, canvasHeightPx: number): number {
  return 2 * Math.atan((subHeightPx / canvasHeightPx) * Math.tan(fovYRadians / 2))
}

/** A screen-space rectangle in CSS pixels, as `getBoundingClientRect` reports it. */
export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The screen-pixel shift needed to re-centre content at `target`'s own centre instead of
 * `canvas`'s — positive `x` means the target sits right of the canvas's centre, positive `y`
 * below it (screen Y grows downward). `Globe.tsx`'s `GlobeCameraControls` negates both into a
 * `camera.setViewOffset` shift (see that call's own doc comment for the sign derivation): a
 * sphere/map at the world origin renders at the canvas's own centre by default, but the fit
 * rectangle it should sit in generally isn't centred in the full-backdrop canvas — the chrome
 * gap is not centred vertically, and in the landscape layout the rectangle sits right of a
 * column of controls.
 */
export function centerOffset(target: ScreenRect, canvas: ScreenRect): { x: number; y: number } {
  return {
    x: target.left + target.width / 2 - (canvas.left + canvas.width / 2),
    y: target.top + target.height / 2 - (canvas.top + canvas.height / 2),
  }
}

/** The visible half-width/half-height at `distance`, shared by `clampPanTarget` (below) and
 *  `mapHasPanRoom` — both need the same "how much of the map plane is on screen right now" figure. */
function visibleHalfExtents(distance: number, aspect: number, fovYRadians: number): { halfWidth: number; halfHeight: number } {
  const halfHeight = distance * Math.tan(fovYRadians / 2)
  return { halfWidth: halfHeight * aspect, halfHeight }
}

/**
 * Whether the map has any room to pan at `distance` — false at (and above) `mapFit`, since the
 * fit distance's own margin already shows slightly *more* than the whole map on every axis
 * (`clampPanTarget`'s `maxX`/`maxY` are both exactly 0 there); true only once zoomed in enough
 * that the viewport shows less than the map's own extent on at least one axis.
 *
 * `Globe.tsx`'s `GlobeCameraControls` uses this to choose the map-mode cursor: at the default,
 * fully-zoomed-out map view this is false (dragging truly does nothing, so `grab` would be
 * misleading), and only flips true once the viewer zooms in, at which point panning starts doing
 * something and `grab` becomes the honest cursor again.
 */
export function mapHasPanRoom(distance: number, aspect: number, fovYRadians: number, mapHalfWidth: number, mapHalfHeight: number): boolean {
  const { halfWidth, halfHeight } = visibleHalfExtents(distance, aspect, fovYRadians)
  return halfWidth < mapHalfWidth || halfHeight < mapHalfHeight
}

/** Whether `frame` is a trustworthy sub-region of a `canvasSize`-sized canvas — non-null and no
 *  bigger, on either axis, than the canvas it's supposedly measured within. `Globe.tsx`'s
 *  `GlobeCameraControls` uses this to gate `subFrameFovY`'s own fallback (and, via
 *  `sphereFrameReady`, whether a plain expand/collapse is allowed to reframe the camera at all)
 *  against a specific browser-verified race: `Globe.tsx` measures the fit-target rectangle via
 *  its own DOM-layer `ResizeObserver`, while `size` (the canvas's real drawing-buffer dimensions)
 *  comes from r3f's own, *independent* `ResizeObserver` — on the render(s) right after `expanded`
 *  flips true, the DOM measurement can already report the correct ~570px box while r3f's own
 *  `size` still reports the *minimised* orb's old, much smaller canvas, before r3f has re-measured
 *  the now-full-viewport `.orbExpanded`. Fed a `frame` larger than the canvas it's meant to be a
 *  sub-region of, `subFrameFovY` computes an effective FOV *wider* than the camera's own real one,
 *  which produces a camera distance far too close, opening the expanded globe zoomed in well past
 *  its intended default framing. */
export function isSubFrameOf(frame: { width: number; height: number } | null, canvasSize: { width: number; height: number }): boolean {
  return frame !== null && frame.height > 0 && frame.width <= canvasSize.width && frame.height <= canvasSize.height
}

/**
 * The device pixel ratio to render at, given a `BUDGET_PIXELS`-sized ceiling on the drawing
 * buffer's total pixel count (`widthPx * heightPx * dpr^2`) — `Globe.tsx`'s replacement for a
 * flat DPR pin on the expanded canvas. A flat pin (`dpr = 1` always) has
 * a flaw independent of whatever frame-rate figure justified it: it bounds nothing. On a small
 * canvas (the minimised orb, or an ordinary laptop's expanded view) it throws away real
 * sharpness the GPU never even struggled to render; on a 5K display it still leaves millions more
 * pixels than the case that prompted the pin in the first place, since it never looks at how
 * large the canvas actually is. A budget on the buffer itself is viewport-independent instead:
 * full `devicePixelRatio` while the buffer is small, tapering smoothly — via `sqrt`, since pixel
 * count grows with the *square* of a linear DPR change — only once it would cross the budget, and
 * bounded on any display. Never below `1` (a `dpr` under 1 would upscale a genuinely
 * under-resolved buffer, not save anything meaningful at this scene's pixel counts) and never
 * above the display's own real `devicePixelRatio` (this only ever trades sharpness for pixels,
 * never invents resolution the display can't show).
 */
export function budgetedDpr(devicePixelRatio: number, widthPx: number, heightPx: number, budgetPixels: number): number {
  const areaPx = widthPx * heightPx
  if (areaPx <= 0) return 1
  return Math.max(1, Math.min(devicePixelRatio, Math.sqrt(budgetPixels / areaPx)))
}

/** A single scroll/pinch step's worth of camera dolly, scaled by `factor` (< 1 moves closer / in,
 *  > 1 moves away / out) and clamped to `[minDistance, maxDistance]` — the same bounds
 *  `OrbitControls`'s own `minDistance`/`maxDistance` props already enforce for scroll/pinch, so a
 *  zoom button (`Globe.tsx`'s `ZoomControls`) can never disagree with them. */
export function clampedDollyDistance(currentDistance: number, factor: number, minDistance: number, maxDistance: number): number {
  return Math.min(maxDistance, Math.max(minDistance, currentDistance * factor))
}

/**
 * Clamps a pan `target` (x, y, world units) so the viewport — half-width/half-height derived
 * from `distance`, `aspect` and `fovYRadians` — never extends past the map's own bounds
 * (`mapHalfWidth`/`mapHalfHeight`): the map can be panned right up to its own edge, never
 * further, so it can never be lost off-screen, and (as a side effect) the viewport never shows
 * empty space beyond the map's edge either. When the viewport is already at least as large as
 * the map on an axis (zoomed out to or past the fit distance), that axis is locked to 0 — the
 * map is already fully framed and there is nothing to pan to.
 */
export function clampPanTarget(
  target: readonly [number, number],
  distance: number,
  aspect: number,
  fovYRadians: number,
  mapHalfWidth: number,
  mapHalfHeight: number,
): [number, number] {
  const { halfWidth: visibleHalfWidth, halfHeight: visibleHalfHeight } = visibleHalfExtents(distance, aspect, fovYRadians)
  const maxX = Math.max(0, mapHalfWidth - visibleHalfWidth)
  const maxY = Math.max(0, mapHalfHeight - visibleHalfHeight)
  return [clampAbs(target[0], maxX), clampAbs(target[1], maxY)]
}

// ------------------------------------------------------------------ sphere <-> map view

/**
 * How far a view is zoomed relative to its own mode's default framing: 1 at the default, 1.25
 * after one zoom-in step. A ratio of camera-to-target distances — the quantity `ZoomControls`
 * and scroll/pinch step multiplicatively — so N steps in on the sphere carry across as N steps in
 * on the map, whatever each mode's default distance is.
 */
export function zoomRatio(defaultDistance: number, distance: number): number {
  return defaultDistance / distance
}

/** Interpolates `a` to `b` geometrically, so a zoom eases at an even perceived rate rather than
 *  rushing through the close end the way a linear distance blend does. Both must be positive. */
export function logLerp(a: number, b: number, t: number): number {
  return a * (b / a) ** t
}

/** Rotates `v` about `+Y` by `angle`, matching three.js's own `Object3D.rotation.y`. */
function rotateY(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}

/** The geographic point at the centre of a sphere-mode view: the camera's own direction from the
 *  globe's centre, undone by the globe's `+Y` rotation. */
export function sphereViewFocus(cameraPosition: Vec3, globeRotationY: number): GlobeEffectAnchor {
  return sphereToLonLat(rotateY(cameraPosition, -globeRotationY))
}

export interface UnfoldCameraPose {
  position: Vec3
  target: Vec3
}

export interface UnfoldViewEnds {
  /** The geographic point held at the centre of the view throughout the unfold. */
  focus: GlobeEffectAnchor
  /** The globe's `+Y` rotation at `unfold = 0`; the mesh eases it to 0 as it flattens
   *  (`useGlobeAutoRotationY`), so this is scaled by `1 - unfold` here too. */
  globeRotationY: number
  radius: number
  /** Height above the surface at each end. */
  sphereHeight: number
  mapHeight: number
  /** The map view's pan target (`z = 0`). Usually `focus`'s own map point, but differs where the
   *  pan clamp keeps the view inside the map's outline — at the default zoom, always the centre. */
  mapTarget: readonly [number, number]
  /** The height that fits the whole unrolled mesh in view at a given `unfold`. */
  meshFitHeight: (unfold: number) => number
}

/**
 * Where the camera sits at `unfold` (0 = sphere, 1 = map) so the sphere <-> map morph reads as one
 * continuous move: the camera stays over `focus`, looking straight down its surface normal, at a
 * height eased between the two ends. The same function of `unfold` in both directions, so a
 * toggle reversed mid-morph just runs back along the same path.
 *
 * The height is the larger of two paths between the same end heights. The first is a plain
 * `logLerp`. The second follows the mesh itself: the view's size relative to the whole mesh,
 * eased from its value at one end to its value at the other. The unrolling mesh widens far faster
 * than a plain interpolation retreats, so without the second path its edges clip partway through;
 * without the first, a mesh that shrinks toward one end would pull the camera in early. Both paths
 * meet both end heights exactly, so neither end jumps — including zoomed in, where the second path
 * scales down with the zoom rather than forcing the camera back out to a whole-mesh fit.
 *
 * The pan offset between `focus`'s own map point and `mapTarget` is blended in by `unfold`, so a
 * default-zoom unfold re-centres on the map while it flattens rather than after.
 */
export function unfoldCameraPose(unfold: number, ends: UnfoldViewEnds): UnfoldCameraPose {
  const u = Math.min(1, Math.max(0, unfold))
  const { focus, radius, sphereHeight, mapHeight, meshFitHeight } = ends
  const rotation = ends.globeRotationY * (1 - u)
  const surface = rotateY(unfoldedPosition(focus, u, radius), rotation)
  const normal = rotateY(unfoldedNormal(focus, u), rotation)

  const plainHeight = logLerp(sphereHeight, mapHeight, u)
  const meshRelative = logLerp(sphereHeight / meshFitHeight(0), mapHeight / meshFitHeight(1), u)
  const height = Math.max(plainHeight, meshFitHeight(u) * meshRelative)

  const [focusMapX, focusMapY] = lonLatToMap(focus, radius)
  const offsetX = (ends.mapTarget[0] - focusMapX) * u
  const offsetY = (ends.mapTarget[1] - focusMapY) * u

  const along = (distance: number): Vec3 => [
    surface[0] + offsetX + normal[0] * distance,
    surface[1] + offsetY + normal[1] * distance,
    surface[2] + normal[2] * distance,
  ]
  return { position: along(height), target: along(-radius) }
}

// ---------------------------------------------------------------------- body proxy raycast

type Vec3 = readonly [number, number, number]

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function pointAt(origin: Vec3, direction: Vec3, t: number): Vec3 {
  return [origin[0] + direction[0] * t, origin[1] + direction[1] * t, origin[2] + direction[2] * t]
}

/**
 * Nearest non-negative intersection of the ray (`origin` + `t` * `direction`) with a sphere of
 * `radius` centred at the local origin, or `null` for a miss. `direction` must be unit length —
 * every caller here feeds it a `THREE.Ray` already run through `applyMatrix4` (`Vector3.
 * transformDirection`'s own doc comment: it re-normalises), the same precondition three.js's own
 * `Ray.intersectSphere` relies on for the identical `b^2 - c` reduction of the ray-sphere
 * quadratic. Hand-rolled rather than calling that three.js method directly — this module's own
 * "no three.js, no React" convention (this file's own top doc comment).
 */
export function raySphereIntersection(origin: Vec3, direction: Vec3, radius: number): Vec3 | null {
  const b = dot3(origin, direction)
  const c = dot3(origin, origin) - radius * radius
  const discriminant = b * b - c
  if (discriminant < 0) return null
  const sqrtDiscriminant = Math.sqrt(discriminant)
  const nearT = -b - sqrtDiscriminant
  const farT = -b + sqrtDiscriminant
  if (farT < 0) return null // the whole sphere is behind the ray's origin
  return pointAt(origin, direction, nearT >= 0 ? nearT : farT)
}

/**
 * Nearest non-negative intersection of the ray with an axis-aligned box (`min`..`max`), or `null`
 * for a miss — the standard "slab" test, hand-rolled for the same "no three.js" reason
 * `raySphereIntersection` above is. Unlike that function, this one has no unit-length
 * precondition on `direction`.
 */
export function rayBoxIntersection(origin: Vec3, direction: Vec3, min: Vec3, max: Vec3): Vec3 | null {
  let tMin = -Infinity
  let tMax = Infinity
  for (let axis = 0; axis < 3; axis += 1) {
    const o = origin[axis]!
    const d = direction[axis]!
    const lo = min[axis]!
    const hi = max[axis]!
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null
      continue
    }
    const t1 = (lo - o) / d
    const t2 = (hi - o) / d
    tMin = Math.max(tMin, Math.min(t1, t2))
    tMax = Math.min(tMax, Math.max(t1, t2))
    if (tMin > tMax) return null
  }
  const t = tMin >= 0 ? tMin : tMax
  if (t < 0) return null
  return pointAt(origin, direction, t)
}

/**
 * Whether a local-space ray hits the globe body's own analytic hit-test proxy at a given
 * `unfold`, or `null` for a miss — without it, a click/tap anywhere on the sphere or map itself
 * falls through to the backdrop's own click-to-collapse handler. `Globe.tsx`'s `GlobeSphere`
 * overrides its mesh's own `raycast` with this
 * (transforming the click ray into local space first): `globeGeometry.ts`'s grid deliberately
 * carries no `position` attribute (every vertex is computed on the GPU from `aLonLat`), so
 * three.js's own default triangle-level raycast always reports a miss there — the same "no
 * `position` attribute for a raycaster to intersect" gap `GlobeTooltip.tsx`'s own doc comment
 * documents for the human layer's markers/arcs, worked around there with screen-space hit-testing
 * instead. This is the equivalent fix for the body mesh itself: a unit sphere at `unfold` 0
 * (`GLOBE_RADIUS` scale is applied by the mesh's own `matrixWorld`, not baked in here — the same
 * `radius = 1` convention `projection.ts` uses throughout), the map's own flat rectangle
 * (`mapHalfWidth`/`mapHalfHeight`, thickened by `mapLocalHalfDepth` along `z` so a grazing ray
 * still registers) at 1 — `projection.ts`'s `unfoldedPosition` doc comment: "the flat endpoint
 * sits at z = radius" — swapped at the tween's midpoint rather than blended continuously, good
 * enough to tell "on the globe" from "off it" without rebuilding real per-vertex geometry every
 * tween frame just for hit-testing.
 */
export function globeBodyProxyHit(
  origin: Vec3,
  direction: Vec3,
  unfold: number,
  mapHalfWidth: number,
  mapHalfHeight: number,
  mapLocalHalfDepth: number,
): Vec3 | null {
  if (unfold >= 0.5) {
    return rayBoxIntersection(
      origin,
      direction,
      [-mapHalfWidth, -mapHalfHeight, 1 - mapLocalHalfDepth],
      [mapHalfWidth, mapHalfHeight, 1 + mapLocalHalfDepth],
    )
  }
  return raySphereIntersection(origin, direction, 1)
}
