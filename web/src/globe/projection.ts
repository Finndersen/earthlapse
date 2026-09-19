/**
 * Pure lon/lat projection math for the globe (docs/GLOBE.md §7, §10: the expanded globe unfolds
 * into an Equal Earth map). No three.js, no React — same convention as `blend.ts` and
 * `effects/math.ts`.
 *
 * Two projections of `{lat, lon}` (`@/types/layer`'s `GlobeEffectAnchor`):
 * - `lonLatToSphere` — see its own doc comment for the sign convention (load-bearing: must match
 *   `globeGeometry.ts`'s grid winding).
 * - `lonLatToMap` — Equal Earth (Šavrič, Jenny & Jenny 2018), centred on 0° longitude, seam at
 *   ±180°. Chosen over equirectangular: closed-form forward projection (cheap per-vertex every
 *   frame) and area-true curved meridians rather than a stretched rectangle.
 *
 * `unfoldedPosition` blends the two via `unfold` (0 = sphere, 1 = map) — what `GLOBE_VERTEX_SHADER`
 * computes per-vertex, and what CPU-side overlay placement uses too. `PROJECTION_GLSL` below is
 * its GLSL twin, built by interpolating these same TS constants so the two can never drift
 * (`projection.test.ts` also pins them). Both operate at `radius = 1` by default, matching
 * `Globe.tsx`'s `GLOBE_RADIUS` mesh-scale convention (`poles.ts`'s `poleDirection` does the same).
 *
 * **Not a plain per-axis lerp of sphere/map xyz (ADR-033 amendment).** A per-vertex lerp has no
 * reason to keep the silhouette convex — it visibly facets into a hexagon/octagon partway through.
 * `unfoldedPosition` instead implements a "curvature unroll": treat the sphere as a surface of
 * curvature `k` (radius `1/k`; `k = 1` is the unit sphere, `k -> 0` flattens it) tangent to the
 * fixed point `(0, 0, radius)` facing the camera, and ease `k` from 1 to 0 while blending each
 * vertex's flat-projection coordinates from equirectangular to Equal Earth's `(x, y)`. Because the
 * tangent point never moves, the silhouette stays a spherical cap at every `unfold` — see
 * `curvatureUnroll`'s own doc comment for the derivation. `unfoldedLiftedPosition` mirrors this
 * with `curvatureNormal` as "which way is up".
 *
 * **The flat endpoint sits at `z = radius`, not `z = 0`.** `lonLatToMap` alone still returns
 * `z = 0` (unchanged, and what `EQUAL_EARTH_HALF_WIDTH`/`_HEIGHT` use). But
 * `unfoldedPosition(point, 1, radius)` places every vertex at `z = radius`, since the curvature
 * unroll keeps the tangent point fixed. `Globe.tsx`'s camera controls account for this offset
 * directly.
 *
 * `splitAtAntimeridian` is the other piece overlay work needs: a polyline must not cross the
 * ±180° seam as one long segment.
 */

import type { GlobeEffectAnchor } from '@/types/layer'

import { glslFloat } from './glsl'

const DEG2RAD = Math.PI / 180

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

// ------------------------------------------------------------------------------ sphere

/**
 * The point on the unit sphere for `{lat, lon}` (degrees): `x = cos(lat)*sin(lon)`,
 * `y = sin(lat)`, `z = cos(lat)*cos(lon)`.
 *
 * **Lon 0 faces `+Z`, not `+X`.** `Globe.tsx`'s default camera sits on `+Z`, and `lonLatToMap`
 * centres the flattened map on lon 0 too — this keeps the sphere's default-facing point and the
 * map's centre the same point during the unfold; a `+X` convention would leave them 90° apart and
 * the mesh would visibly squeeze one hemisphere to one side while unfolding rather than opening
 * out symmetrically. The sign of `x` and which axis carries `sin(lon)` are load-bearing for a
 * second reason: `globeGeometry.ts`'s grid winding is only outward-facing when paired with a
 * position formula of matching handedness (see its own doc comment and `globeGeometry.test.ts`'s
 * numeric check).
 *
 * `+Y` is the geographic north pole, matching `poles.ts`'s `poleDirection('N') = [0, 1, 0]`.
 * `atan2(x, z) = lon` and `asin(y) = lat` for this sign convention — `arcs.ts`'s
 * `greatCircleLonLatPoints` relies on that inverse to recover lon/lat from a 3D point.
 */
export function lonLatToSphere(point: GlobeEffectAnchor, radius = 1): readonly [number, number, number] {
  const lambda = point.lon * DEG2RAD
  const phi = point.lat * DEG2RAD
  const cosPhi = Math.cos(phi)
  return [radius * cosPhi * Math.sin(lambda), radius * Math.sin(phi), radius * cosPhi * Math.cos(lambda)]
}

// --------------------------------------------------------------------------- equal earth

/** Coefficients from Šavrič, Jenny & Jenny (2018), "A Higher-Order Equal-Area Projection for
 *  Statistical Maps" — the same closed-form projection `d3-geo`'s `geoEqualEarth` uses. Exported
 *  so `PROJECTION_GLSL` below can interpolate them by value rather than hand-copying
 *  (`projection.test.ts` pins them). */
export const EQUAL_EARTH_A1 = 1.340264
export const EQUAL_EARTH_A2 = -0.081106
export const EQUAL_EARTH_A3 = 0.000893
export const EQUAL_EARTH_A4 = 0.003796
export const EQUAL_EARTH_M = Math.sqrt(3) / 2

/**
 * The Equal Earth projection of `{lat, lon}` (degrees), centred on 0° longitude — `z` is always
 * 0. Forward-only: the published inverse needs Newton iteration, and no caller here needs it.
 */
export function lonLatToMap(point: GlobeEffectAnchor, radius = 1): readonly [number, number, number] {
  const lambda = point.lon * DEG2RAD
  const phi = point.lat * DEG2RAD
  const theta = Math.asin(EQUAL_EARTH_M * Math.sin(phi))
  const theta2 = theta * theta
  const theta6 = theta2 * theta2 * theta2
  const x =
    (radius * lambda * Math.cos(theta)) /
    (EQUAL_EARTH_M * (EQUAL_EARTH_A1 + 3 * EQUAL_EARTH_A2 * theta2 + theta6 * (7 * EQUAL_EARTH_A3 + 9 * EQUAL_EARTH_A4 * theta2)))
  const y = radius * theta * (EQUAL_EARTH_A1 + EQUAL_EARTH_A2 * theta2 + theta6 * (EQUAL_EARTH_A3 + EQUAL_EARTH_A4 * theta2))
  return [x, y, 0]
}

/** The map's own half-width (widest at the equator — Equal Earth's meridians curve inward toward
 *  the poles) and half-height (widest at the poles, which Equal Earth flattens to a line of finite
 *  width, not a point). Derived from `lonLatToMap` itself at `radius = 1` so they can never drift
 *  from the formula; `Globe.tsx` scales them by `GLOBE_RADIUS` for camera framing and pan clamping
 *  (`camera.ts`). */
export const EQUAL_EARTH_HALF_WIDTH = lonLatToMap({ lon: 180, lat: 0 })[0]
export const EQUAL_EARTH_HALF_HEIGHT = lonLatToMap({ lon: 0, lat: 90 })[1]

// -------------------------------------------------------------------------------- mixed

/** Below this, `k` is treated as exactly 0 rather than evaluated through the general curvature
 *  formula: `curvatureUnroll`'s `z` term subtracts two `O(1/k)` quantities that individually blow
 *  up as `k -> 0`, and forming each huge intermediate loses precision before `k` reaches this
 *  threshold. `unfoldAnimation.ts` clamps `unfold` so `k` only ever reaches exactly 1 at the
 *  tween's own end — this is a safety margin against floating-point noise near that end, not a
 *  real animation state. */
const CURVATURE_EPSILON = 1e-4

function normalize3(v: readonly [number, number, number]): readonly [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2])
  return [v[0] / len, v[1] / len, v[2] / len]
}

/**
 * The "curvature unroll" globe<->map morph (ADR-033 amendment; see the module doc comment for why
 * a plain per-axis lerp doesn't work). `(x, y)` are flat-projection coordinates at radius 1 —
 * `lonLatToSphere`'s own angles at `k = 1`, `lonLatToMap`'s own `(x, y)` at `k = 0` — and `k` is
 * the curvature, 1 (unit sphere) down to 0 (flat plane).
 *
 * Derivation: place `(x, y)` on a sphere of radius `1/k` centred at `(0, 0, 1 - 1/k)` (tangent to
 * `(0, 0, 1)` for every `k`), parameterised by angles `x*k`, `y*k` so the angular span covered
 * shrinks as the sphere grows. Two checks confirm this is the right surface: at `k = 1` it reduces
 * exactly to `lonLatToSphere`'s own formula; as `k -> 0`, Taylor-expanding `sin`/`cos` to `O(k^2)`
 * gives `x`, `y`, `z -> 1` — the flat plane `z = 1` — with `(0, 0)` landing at `z = 1` for every
 * `k`, not just in the limit (the fixed tangent point).
 *
 * `z` is written as `(cos(xk)*cos(yk) - 1)/k + 1`, not `cos(xk)*cos(yk)/k - 1/k + 1`: algebraically
 * identical, but the first never forms the individually-huge `.../k` terms whose difference is
 * what's actually finite, so it stays well-conditioned down to `CURVATURE_EPSILON` instead of
 * losing precision to cancellation earlier. Below that threshold, `k = 0` is used directly (the
 * limit above, no division) rather than a Taylor series, since the animation only ever approaches
 * `k = 0` from above and settles there exactly.
 */
function curvatureUnroll(x: number, y: number, k: number): readonly [number, number, number] {
  if (k < CURVATURE_EPSILON) return [x, y, 1]
  const xk = x * k
  const yk = y * k
  return [(Math.sin(xk) * Math.cos(yk)) / k, Math.sin(yk) / k, (Math.cos(xk) * Math.cos(yk) - 1) / k + 1]
}

/** The outward direction at `(x, y, k)`'s point on `curvatureUnroll`'s sphere of radius `1/k`
 *  centred at `(0, 0, 1 - 1/k)` — radial on the sphere (`k = 1`), flattening continuously to a
 *  constant `(0, 0, 1)` as `k -> 0`. `unfoldedLiftedPosition`'s "which way is up", valid at every
 *  `unfold`, not just the two endpoints. */
function curvatureNormal(x: number, y: number, k: number): readonly [number, number, number] {
  if (k < CURVATURE_EPSILON) return [0, 0, 1]
  const [px, py, pz] = curvatureUnroll(x, y, k)
  const centerZ = 1 - 1 / k
  return normalize3([px, py, pz - centerZ])
}

/** Both flat-projection coordinates blended by `unfold` (`s`): equirectangular (`lonLatToSphere`'s
 *  own angle inputs) toward Equal Earth's `(x, y)` at `radius = 1` — see the module doc comment
 *  for why these, not the two functions' xyz output, are what gets blended. */
function unrolledXY(point: GlobeEffectAnchor, s: number): readonly [number, number] {
  const lambda = point.lon * DEG2RAD
  const phi = point.lat * DEG2RAD
  const [mapX, mapY] = lonLatToMap(point, 1)
  return [lambda + (mapX - lambda) * s, phi + (mapY - phi) * s]
}

/** `lonLatToSphere` and `lonLatToMap` joined by the curvature unroll above, `unfold` (0 = sphere,
 *  1 = map, clamped) driving both the coordinate blend and curvature `k = 1 - unfold`. Mirrored in
 *  GLSL by `PROJECTION_GLSL`'s own `unfoldedPosition` for `GLOBE_VERTEX_SHADER`; exported here for
 *  CPU-side callers (`GlobeTooltip.tsx`'s hit test). */
export function unfoldedPosition(point: GlobeEffectAnchor, unfold: number, radius = 1): readonly [number, number, number] {
  const s = clamp01(unfold)
  const [x, y] = unrolledXY(point, s)
  const [ux, uy, uz] = curvatureUnroll(x, y, 1 - s)
  return [ux * radius, uy * radius, uz * radius]
}

/**
 * `unfoldedPosition`, but for an overlay drawn slightly above the surface (arrival arcs and
 * markers). The lift needs different treatment per mode: on the sphere it's a radial lift
 * (`sphereLift`, a fraction of `radius`); on the flat map there is no radial direction, so the
 * equivalent is a small constant `+z` offset toward the camera (`mapZOffset`), applied without
 * also scaling `x`/`y` (which would inflate them and move a marker off its true lat/lon).
 * `curvatureNormal` gives "which way is up" continuously across the unroll, so both fractions
 * blend into one lift amount along a single direction rather than lifting two positions and
 * lerping the results. */
export function unfoldedLiftedPosition(
  point: GlobeEffectAnchor,
  unfold: number,
  radius: number,
  sphereLift: number,
  mapZOffset: number,
): readonly [number, number, number] {
  const s = clamp01(unfold)
  const [x, y] = unrolledXY(point, s)
  const k = 1 - s
  const [bx, by, bz] = curvatureUnroll(x, y, k)
  const [nx, ny, nz] = curvatureNormal(x, y, k)
  const lift = sphereLift * radius * (1 - s) + mapZOffset * s
  return [bx * radius + nx * lift, by * radius + ny * lift, bz * radius + nz * lift]
}

/**
 * The unrolled mesh's own bounding half-width/half-height at a given `unfold`, at `radius = 1` —
 * `Globe.tsx`'s `GlobeCameraControls` scales these by `GLOBE_RADIUS` to size its map-mode camera
 * fit against the mesh's actual current silhouette, not a linear lerp between the sphere's and the
 * map's own half-extents (the real curvature-unrolled silhouette does not grow at a uniform rate,
 * so a lerp-sized camera visibly over/undershoots partway through the unroll). Numeric sampling
 * (not a closed form) finds the true width maximum however the silhouette varies, without solving
 * for exactly where the equator's widest point crosses from an interior longitude to the map's
 * own edge.
 *
 * Height needs no equivalent search: `unfoldedPosition`'s `y` depends on latitude alone and stays
 * monotonic for every `unfold` in this mesh's domain, so the pole (`lat = 90`) is always the true
 * maximum — still swept here rather than evaluated once, so a future change to either endpoint's
 * extent can't silently invalidate that reasoning.
 */
export function unrolledHalfWidth(unfold: number, radius = 1, samples = 180): number {
  let maxAbsX = 0
  for (let i = 0; i <= samples; i++) {
    const lon = -180 + (360 * i) / samples
    const [x] = unfoldedPosition({ lon, lat: 0 }, unfold, radius)
    maxAbsX = Math.max(maxAbsX, Math.abs(x))
  }
  return maxAbsX
}

export function unrolledHalfHeight(unfold: number, radius = 1, samples = 90): number {
  let maxAbsY = 0
  for (let i = 0; i <= samples; i++) {
    const lat = -90 + (180 * i) / samples
    const [, y] = unfoldedPosition({ lon: 0, lat }, unfold, radius)
    maxAbsY = Math.max(maxAbsY, Math.abs(y))
  }
  return maxAbsY
}

// ---------------------------------------------------------------------------- GLSL twin

/**
 * `lonLatToSphere`/`lonLatToMap`/`unfoldedPosition` above, restated in GLSL for
 * `GLOBE_VERTEX_SHADER` (`shaders.ts`) and the human layer's arc/marker vertex shaders. Every
 * numeric constant is interpolated from the TS values above rather than retyped, so the two
 * implementations cannot drift (`projection.test.ts` also pins them). Always at `radius = 1` —
 * GLSL callers scale via the mesh's own transform (`Globe.tsx`'s `<mesh scale={GLOBE_RADIUS}>`).
 */
export const PROJECTION_GLSL = /* glsl */ `
const float EE_A1 = ${glslFloat(EQUAL_EARTH_A1)};
const float EE_A2 = ${glslFloat(EQUAL_EARTH_A2)};
const float EE_A3 = ${glslFloat(EQUAL_EARTH_A3)};
const float EE_A4 = ${glslFloat(EQUAL_EARTH_A4)};
const float EE_M = ${glslFloat(EQUAL_EARTH_M)};
const float EE_DEG2RAD = ${glslFloat(DEG2RAD)};

// lonLatDeg: x = lon, y = lat (degrees). Lon 0 faces +Z — see lonLatToSphere's doc comment
// above for why this axis choice is load-bearing.
vec3 lonLatToSphere(vec2 lonLatDeg) {
  float lambda = lonLatDeg.x * EE_DEG2RAD;
  float phi = lonLatDeg.y * EE_DEG2RAD;
  float cosPhi = cos(phi);
  return vec3(cosPhi * sin(lambda), sin(phi), cosPhi * cos(lambda));
}

vec3 lonLatToMap(vec2 lonLatDeg) {
  float lambda = lonLatDeg.x * EE_DEG2RAD;
  float phi = lonLatDeg.y * EE_DEG2RAD;
  float theta = asin(EE_M * sin(phi));
  float theta2 = theta * theta;
  float theta6 = theta2 * theta2 * theta2;
  float x = lambda * cos(theta) / (EE_M * (EE_A1 + 3.0 * EE_A2 * theta2 + theta6 * (7.0 * EE_A3 + 9.0 * EE_A4 * theta2)));
  float y = theta * (EE_A1 + EE_A2 * theta2 + theta6 * (EE_A3 + EE_A4 * theta2));
  return vec3(x, y, 0.0);
}

const float CURVATURE_EPSILON = ${glslFloat(CURVATURE_EPSILON)};

// curvatureUnroll/unfoldedPosition: see the TS twin's doc comment above for the derivation and
// endpoint proof. z is written to avoid the same cancellation the TS twin avoids.
vec3 curvatureUnroll(float x, float y, float k) {
  if (k < CURVATURE_EPSILON) return vec3(x, y, 1.0);
  float xk = x * k;
  float yk = y * k;
  return vec3(sin(xk) * cos(yk) / k, sin(yk) / k, (cos(xk) * cos(yk) - 1.0) / k + 1.0);
}

vec2 unrolledXY(vec2 lonLatDeg, float s) {
  float lambda = lonLatDeg.x * EE_DEG2RAD;
  float phi = lonLatDeg.y * EE_DEG2RAD;
  vec3 map = lonLatToMap(lonLatDeg);
  return vec2(lambda + (map.x - lambda) * s, phi + (map.y - phi) * s);
}

vec3 unfoldedPosition(vec2 lonLatDeg, float unfold) {
  float s = clamp(unfold, 0.0, 1.0);
  vec2 xy = unrolledXY(lonLatDeg, s);
  return curvatureUnroll(xy.x, xy.y, 1.0 - s);
}

// curvatureNormal/unfoldedLiftedPosition: see the TS twin's doc comment above. Radius = 1 — GLSL
// callers scale via the mesh's own transform, same as elsewhere in this file.
vec3 curvatureNormal(float x, float y, float k) {
  if (k < CURVATURE_EPSILON) return vec3(0.0, 0.0, 1.0);
  vec3 p = curvatureUnroll(x, y, k);
  float centerZ = 1.0 - 1.0 / k;
  return normalize(vec3(p.x, p.y, p.z - centerZ));
}

vec3 unfoldedLiftedPosition(vec2 lonLatDeg, float unfold, float sphereLift, float mapZOffset) {
  float s = clamp(unfold, 0.0, 1.0);
  vec2 xy = unrolledXY(lonLatDeg, s);
  float k = 1.0 - s;
  vec3 base = curvatureUnroll(xy.x, xy.y, k);
  vec3 normalDir = curvatureNormal(xy.x, xy.y, k);
  float lift = sphereLift * (1.0 - s) + mapZOffset * s;
  return base + normalDir * lift;
}
`

// ------------------------------------------------------------------- antimeridian split

/**
 * Splits a lon/lat polyline into pieces that never cross the ±180° seam, inserting a point exactly
 * at the seam (latitude linearly interpolated) on each side of a crossing so both pieces still
 * reach the map's edge. Used by `arcs.ts`'s `buildArrivalArcGeometry`: a path drawn straight across
 * the flattened Equal Earth map would otherwise stretch across the whole width — the same seam
 * problem `globeGeometry.ts` solves for the base mesh, but for arbitrary point sequences.
 *
 * Generic over `T` so a caller can attach extra per-point data that survives the split, including
 * through the two synthesized seam points — `arcs.ts` attaches a cumulative "distance along the
 * whole arc" field so a dash pattern stays continuous across a split. `interpolateExtra(prev,
 * curr, f)` computes that data for a seam point at fraction `f` (the same fraction latitude is
 * interpolated by); omitted, a seam point carries no fields beyond `lon`/`lat`.
 *
 * `points.length <= 1` returns the input as a single segment.
 */
export function splitAtAntimeridian<T extends GlobeEffectAnchor>(
  points: readonly T[],
  interpolateExtra?: (prev: T, curr: T, f: number) => Omit<T, keyof GlobeEffectAnchor>,
): T[][] {
  if (points.length === 0) return []
  const segments: T[][] = [[points[0]!]]

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!
    const curr = points[i]!
    const delta = curr.lon - prev.lon

    if (Math.abs(delta) > 180) {
      // The shorter path crosses ±180°, not 0°; `goingEast` means heading from just under +180
      // to just over -180.
      const goingEast = delta < 0
      const seamPrevLon = goingEast ? 180 : -180
      const seamCurrLon = goingEast ? -180 : 180
      // Unwrap curr's longitude onto the same line as prev so the seam latitude is a plain
      // linear interpolation — exact for straight-line paths (event arcs, not great circles).
      const unwrappedCurrLon = goingEast ? curr.lon + 360 : curr.lon - 360
      const f = (seamPrevLon - prev.lon) / (unwrappedCurrLon - prev.lon)
      const seamLat = prev.lat + (curr.lat - prev.lat) * f
      const extra = interpolateExtra?.(prev, curr, f) ?? ({} as Omit<T, keyof GlobeEffectAnchor>)

      segments[segments.length - 1]!.push({ ...extra, lon: seamPrevLon, lat: seamLat } as T)
      segments.push([{ ...extra, lon: seamCurrLon, lat: seamLat } as T, curr])
    } else {
      segments[segments.length - 1]!.push(curr)
    }
  }

  return segments
}
