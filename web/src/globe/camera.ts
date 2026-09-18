/**
 * Pure camera-framing math for the expanded globe's map mode (docs/GLOBE.md's ADR-033).
 * No three.js, no React — `Globe.tsx`'s `GlobeCameraControls` is the thin consumer, the same
 * split `globeGeometry.ts` and `blend.ts` use for their own math.
 */

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

/**
 * The screen-pixel shift needed to re-centre content at `targetRect`'s own vertical centre
 * instead of `canvasRect`'s — positive means the target sits *below* the canvas's centre (screen
 * Y grows downward). `Globe.tsx`'s `GlobeCameraControls` negates this into a
 * `camera.setViewOffset` Y offset (see that call's own doc comment for the sign derivation): a
 * sphere/map that sits at the world origin renders at the canvas's own centre by default, but the
 * chrome-gap rectangle it should visually sit in generally isn't centred in the *canvas* now that
 * the canvas is the whole backdrop (the gap itself isn't centred in the viewport either — the
 * title band above it is shorter than the caption-plus-timeline band below,
 * `Globe.module.css`'s own doc comment).
 */
export function verticalCenterOffset(targetTopPx: number, targetHeightPx: number, canvasTopPx: number, canvasHeightPx: number): number {
  const targetCenterY = targetTopPx + targetHeightPx / 2
  const canvasCenterY = canvasTopPx + canvasHeightPx / 2
  return targetCenterY - canvasCenterY
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
 * `Globe.tsx`'s `GlobeCameraControls` uses this to choose the map-mode cursor (issue 3, user
 * verbatim: "when it's expanded to a map it still has the 'drag hand' mouse icon... dragging
 * doesn't do anything in this mode") — at the default, fully-zoomed-out map view this is false
 * (dragging truly does nothing, matching the report), and only flips true once the viewer zooms
 * in, at which point panning starts doing something and `grab` becomes the honest cursor again.
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
 *  which produces a camera distance far too close — the root cause behind a real regression (user
 *  report: "opens zoomed in a lot, need to press zoom out 6 times to get it back to reasonable
 *  original size"). */
export function isSubFrameOf(frame: { width: number; height: number } | null, canvasSize: { width: number; height: number }): boolean {
  return frame !== null && frame.height > 0 && frame.width <= canvasSize.width && frame.height <= canvasSize.height
}

/** A single scroll/pinch step's worth of camera dolly, scaled by `factor` (< 1 moves closer / in,
 *  > 1 moves away / out) and clamped to `[minDistance, maxDistance]` — the same bounds
 *  `OrbitControls`'s own `minDistance`/`maxDistance` props already enforce for scroll/pinch, so a
 *  zoom button (`Globe.tsx`'s `ZoomControls`) can never disagree with them. */
export function clampedDollyDistance(currentDistance: number, factor: number, minDistance: number, maxDistance: number): number {
  return Math.min(maxDistance, Math.max(minDistance, currentDistance * factor))
}

function cross3(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function lengthSq3(a: readonly [number, number, number]): number {
  return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]
}

function normalize3(a: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(a[0], a[1], a[2])
  return [a[0] / len, a[1] / len, a[2] / len]
}

/**
 * Spherical linear interpolation between two unit-length 3D directions — blends a camera's own
 * viewing direction toward a target one *along the sphere of directions itself*, not through its
 * interior the way a plain `lerp` followed by `normalize()` does. A straight lerp between two
 * directions more than ~90° apart dips toward (and, if they are exactly opposite, passes exactly
 * through) the zero vector partway along the blend, where `normalize()` is undefined; even short
 * of that, it swings the camera *through* the globe's own interior rather than *around* its
 * surface, which reads as an abrupt ~180°-ish flip — the bug this fixes, reported when a viewer
 * had orbited to the globe's far side before pressing "Map" (`Globe.tsx`'s `GlobeCameraControls`,
 * the one caller).
 *
 * `upAxisFallback` resolves the ambiguity when `a` and `b` are (numerically) antipodal: no single
 * great circle connects two exactly opposite points, so this picks one by rotating through
 * whichever axis is perpendicular to both `a` and `upAxisFallback` — the same "pick an arbitrary
 * axis" resolution every antipodal-rotation routine needs somehow — falling back to a second,
 * unrelated axis in the vanishingly unlikely case `a` already *is* the up axis (so the first
 * cross product would itself be zero-length).
 */
export function slerpDirection(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
  upAxisFallback: readonly [number, number, number] = [0, 1, 0],
): readonly [number, number, number] {
  const clampedT = Math.min(1, Math.max(0, t))
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  const EPSILON = 1e-6

  if (dot > 1 - EPSILON) return a // Identical (or numerically indistinguishable): nothing to blend.

  if (dot < -1 + EPSILON) {
    let perp = cross3(upAxisFallback, a)
    if (lengthSq3(perp) < EPSILON) perp = cross3([1, 0, 0], a)
    const [px, py, pz] = normalize3(perp)
    const theta = Math.PI * clampedT
    const cosTheta = Math.cos(theta)
    const sinTheta = Math.sin(theta)
    return [a[0] * cosTheta + px * sinTheta, a[1] * cosTheta + py * sinTheta, a[2] * cosTheta + pz * sinTheta]
  }

  const theta = Math.acos(dot)
  const sinTheta = Math.sin(theta)
  const wa = Math.sin((1 - clampedT) * theta) / sinTheta
  const wb = Math.sin(clampedT * theta) / sinTheta
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb]
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
