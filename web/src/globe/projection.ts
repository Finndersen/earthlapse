/**
 * Pure lon/lat projection math for the globe (docs/GLOBE.md §7, §10: the expanded globe unfolds
 * into an Equal Earth map). No three.js, no React — the same convention `blend.ts` and
 * `effects/math.ts` follow for their own pure cores.
 *
 * Two projections of the same `{lat, lon}` point (`@/types/layer`'s `GlobeEffectAnchor` — reused
 * rather than a synonym type, since a projection input is exactly "a present-day location"):
 *
 * - `lonLatToSphere` — see its own doc comment for the sign convention and why it matters
 *   (`globeGeometry.ts`'s grid winding).
 * - `lonLatToMap` — Equal Earth (Šavrič, Jenny & Jenny 2018), centred on 0° longitude with the
 *   seam at ±180°. Chosen over equirectangular: its forward projection is closed-form (no
 *   iteration, cheap enough to run per-vertex every frame), and it reads as a genuine world map
 *   (curved meridians, area-true) rather than a stretched rectangle. The coefficients are the
 *   ones published with the projection (and used by, among others, d3-geo's own
 *   `geoEqualEarth`); `PROJECTION_GLSL` below interpolates the same TS constants into its GLSL
 *   twin, so the two can never drift apart (`projection.test.ts` pins them anyway, as a
 *   regression net against a hand-edited GLSL literal).
 *
 * `unfoldedPosition` is the two combined by `unfold` (0 = sphere, 1 = map) — what `Globe.tsx`'s
 * mesh (`globeGeometry.ts`) computes per-vertex in `GLOBE_VERTEX_SHADER`, and what arc/marker
 * overlays (`HumanCivilisation.tsx`) place themselves at, on the CPU side, through the same formula.
 * Both operate at `radius = 1` by default, matching `Globe.tsx`'s own `GLOBE_RADIUS` convention
 * (`poles.ts`'s `poleDirection` does the same: returns a unit vector, leaves scaling to the
 * caller) — `Globe.tsx` scales its mesh by `GLOBE_RADIUS` via `<mesh scale>` rather than baking
 * a radius into every vertex, so both the sphere and the map read at the same size.
 *
 * **Not a plain per-axis lerp of the two positions (ADR-033 amendment).** An earlier version
 * mixed `lonLatToSphere`/`lonLatToMap`'s xyz output directly (`lerp(sphere, map, unfold)`).
 * Browser-verified regression (user report, contact sheets in `scratchpad/transition-*`): the
 * sphere's round silhouette collapses straight toward the map's rectangle-ish one, passing
 * through a visibly faceted hexagon/octagon/square along the way, because a per-vertex xyz lerp
 * has no reason to trace a silhouette that stays convex and smooth — each vertex just walks a
 * straight line between two unrelated points. `unfoldedPosition` instead implements the
 * standard "curvature unroll" globe<->map morph (the mechanism behind e.g. Jason Davies' map
 * projection transitions): treat the sphere as a surface of curvature `k` (radius `1/k`, so
 * `k = 1` is the ordinary unit sphere and `k -> 0` flattens it), tangent to the fixed point
 * `(0, 0, radius)` — the point directly facing the camera — for every `k`. Unrolling the map
 * is then just easing `k` from 1 to 0 while blending each vertex's flat-projection coordinates
 * from equirectangular (`lon`, `lat` in radians — exactly what `lonLatToSphere` itself takes as
 * its sphere angle at `k = 1`) to Equal Earth's own `(x, y)`. Because the tangent point never
 * moves and every vertex's own "latitude"/"longitude" role is preserved throughout, the
 * silhouette stays a spherical cap (never a polygon) at every `unfold` — see `curvatureUnroll`'s
 * own doc comment for the closed-form derivation and endpoint proof. `unfoldedLiftedPosition`
 * mirrors this with `curvatureNormal` standing in for "which way is up" (radial on the sphere,
 * `+Z` on the flat map, continuously in between).
 *
 * **The flat endpoint sits at `z = radius`, not `z = 0`.** `lonLatToMap` alone still returns
 * `z = 0` (unchanged, and still what `EQUAL_EARTH_HALF_WIDTH`/`_HEIGHT` and every direct
 * `lonLatToMap` caller use). But `unfoldedPosition(point, 1, radius)` — the fully-unrolled map,
 * reached by easing `unfold` up to 1 — places every vertex at `z = radius`: the curvature unroll
 * keeps the tangent point `(0, 0, radius)` fixed for every `k`, and the whole sheet flattens
 * around it, not around `z = 0`. `Globe.tsx`'s `GlobeCameraControls`/`camera.ts` account for this
 * fixed offset directly (a camera target that itself eases toward `(pan, pan, radius)` in map
 * mode) rather than the projection re-centring itself to match the old, unrelated convention.
 *
 * `splitAtAntimeridian` is the other piece overlay work needs: a polyline drawn across the map
 * must not cross the ±180° seam as one long segment spanning the whole width.
 */

import type { GlobeEffectAnchor } from '@/types/layer'

import { glslFloat } from './glsl'

const DEG2RAD = Math.PI / 180

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

// ------------------------------------------------------------------------------ sphere

/**
 * The point on the unit sphere for `{lat, lon}` (degrees), in the globe's own object space.
 * `x = cos(lat)*sin(lon)`, `y = sin(lat)`, `z = cos(lat)*cos(lon)`.
 *
 * **Lon 0 faces `+Z`, not `+X`.** `Globe.tsx`'s default camera sits on `+Z` looking back at the
 * origin (`CAMERA_DISTANCE`), and `lonLatToMap` (below) centres the *flattened* map on lon 0 too
 * — putting lon 0 at `+Z` here is what makes the sphere's own default-facing point and the map's
 * own centre the *same* point. An earlier version put lon 0 at `+X` instead (a quarter-turn off):
 * visually harmless for the sphere alone (auto-rotate shows every longitude in turn regardless of
 * where it starts), but during the sphere<->map unfold, the point sitting front-and-centre on the
 * sphere and the point sitting centre-of-frame on the map disagreed by 90° — the mesh visibly
 * squeezed one hemisphere into a strip to one side of the frame while unfolding, rather than
 * opening out symmetrically from the middle.
 *
 * Both the sign of `x` and which axis carries `sin(lon)` are load-bearing, not arbitrary, for a
 * second reason: `globeGeometry.ts`'s grid indexes its triangles to match `THREE.SphereGeometry`'s
 * own winding, which is only outward-facing when paired with a position formula of matching
 * handedness (`globeGeometry.ts`'s own doc comment, `globeGeometry.test.ts`'s numeric check).
 * This formula is exactly the previous, numerically-verified one evaluated at `lon - 90°` instead
 * of `lon` (`cos(lon-90) = sin(lon)`, `sin(lon-90) = -cos(lon)`) — a rigid rotation of the whole
 * sphere about `+Y`, which preserves handedness (rotation cannot turn an outward-facing triangle
 * inward), so the winding stays correct without a second numeric re-derivation.
 *
 * `+Y` is the geographic north pole, matching `poles.ts`'s `poleDirection('N') = [0, 1, 0]`.
 * `atan2(x, z) = lon` and `asin(y) = lat` with this sign (see `GLOBE_FRAGMENT_SHADER`'s own uv
 * derivation, `shaders.ts`, for how the texture-sampling side uses that — uv is computed straight
 * from lon/lat there, not via this formula's inverse, so it is unaffected by this choice either
 * way; `arcs.ts`'s `greatCircleLonLatPoints` is the one place that *does* need the matching
 * inverse, to recover a great-circle point's own lon/lat from its 3D position).
 */
export function lonLatToSphere(point: GlobeEffectAnchor, radius = 1): readonly [number, number, number] {
  const lambda = point.lon * DEG2RAD
  const phi = point.lat * DEG2RAD
  const cosPhi = Math.cos(phi)
  return [radius * cosPhi * Math.sin(lambda), radius * Math.sin(phi), radius * cosPhi * Math.cos(lambda)]
}

// --------------------------------------------------------------------------- equal earth

/** Coefficients from Šavrič, Jenny & Jenny (2018), "A Higher-Order Equal-Area Projection for
 *  Statistical Maps" — the same closed-form forward projection `d3-geo`'s `geoEqualEarth` uses.
 *  Exported (not module-private) purely so `PROJECTION_GLSL` below can interpolate them by
 *  value rather than hand-copying — see `projection.test.ts`'s pinning test. */
export const EQUAL_EARTH_A1 = 1.340264
export const EQUAL_EARTH_A2 = -0.081106
export const EQUAL_EARTH_A3 = 0.000893
export const EQUAL_EARTH_A4 = 0.003796
export const EQUAL_EARTH_M = Math.sqrt(3) / 2

/**
 * The Equal Earth projection of `{lat, lon}` (degrees), centred on 0° longitude — `z` is always
 * 0 (the map is flat). Forward-only (the published inverse needs Newton iteration; nothing here
 * needs it — every caller has a lon/lat and wants a position, never the reverse).
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

/** The map's own half-width (at the equator, its widest point — Equal Earth's meridians curve
 *  inward toward the poles, so the equator is the binding width everywhere) and half-height (at
 *  either pole — Equal Earth flattens the poles to a line, not a point, of finite width). Both
 *  computed from `lonLatToMap` itself, at `radius = 1`, rather than hand-copied literals, so
 *  they can never drift from the formula above; `Globe.tsx` scales them by `GLOBE_RADIUS` for
 *  camera framing and pan clamping (`camera.ts`). */
export const EQUAL_EARTH_HALF_WIDTH = lonLatToMap({ lon: 180, lat: 0 })[0]
export const EQUAL_EARTH_HALF_HEIGHT = lonLatToMap({ lon: 0, lat: 90 })[1]

// -------------------------------------------------------------------------------- mixed

/** Below this, `k` is treated as exactly 0 (the flat endpoint) rather than evaluated through the
 *  general curvature formula: `curvatureUnroll`'s own `z` term subtracts two `O(1/k)` quantities
 *  that individually blow up as `k -> 0` (their *difference* stays finite and smooth — see its
 *  own doc comment — but forming each huge intermediate first loses precision well before `k`
 *  reaches this threshold). The eased `unfold` driving `k = 1 - unfold` only ever *reaches* 1
 *  exactly at the tween's own end (`unfoldAnimation.ts` clamps there), so this clamp is a safety
 *  margin against floating-point noise near that end, not a real animation state. */
const CURVATURE_EPSILON = 1e-4

function normalize3(v: readonly [number, number, number]): readonly [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2])
  return [v[0] / len, v[1] / len, v[2] / len]
}

/**
 * The "curvature unroll" globe<->map morph (ADR-033 amendment; see this module's doc comment for
 * why a plain per-axis lerp doesn't work). `(x, y)` are flat-projection coordinates at `radius`
 * 1 — `lonLatToSphere`'s own angles (`lambda`, `phi`, radians) at `k = 1`, `lonLatToMap`'s own
 * `(x, y)` at `k = 0` — and `k` is the curvature, `1` (the ordinary unit sphere) down to `0` (the
 * flat plane).
 *
 * Derivation: place `(x, y)` on a sphere of radius `1/k` centred at `(0, 0, 1 - 1/k)` — i.e.
 * tangent to `(0, 0, 1)` for every `k` — parameterising its surface by angles `x*k`, `y*k` (so
 * the angular *span* covered shrinks as the sphere grows, the same way a fixed patch of a bigger
 * sphere looks flatter). That gives exactly the formula below. Two checks confirm it is the
 * right one:
 * - **`k = 1` is exactly `lonLatToSphere`.** The sphere is then centred at the origin with
 *   radius 1, i.e. `x = sin(x)*cos(y)`, `y = sin(y)`, `z = cos(x)*cos(y)` — `lonLatToSphere`'s
 *   own formula at `(lambda, phi) = (x, y)`.
 * - **`k -> 0` is exactly the flat plane `z = 1`.** Taylor-expanding `sin`/`cos` to `O(k^2)`:
 *   `sin(xk)/k = x - O(k^2) -> x`, `sin(yk)/k -> y`, and `(cos(xk)*cos(yk) - 1)/k`'s numerator is
 *   itself `O(k^2)` (both cosines are `1 - O(k^2)`), so the whole term is `O(k)` and vanishes,
 *   leaving `z -> 1`. The `(0, 0)` point (`x = y = 0`) gives `z = 1` at *every* `k`, not just in
 *   the limit — `sin(0) = 0` and `cos(0) = 1` regardless of `k` — which is `unfoldedPosition`'s
 *   "the centre stays fixed" property, exactly.
 *
 * The `z` formula is written as `(cos(xk)*cos(yk) - 1)/k + 1`, not `cos(xk)*cos(yk)/k - 1/k + 1`:
 * algebraically identical, but the first never forms the individually-huge `.../k` terms whose
 * difference is what's actually finite, so it stays well-conditioned down to `CURVATURE_EPSILON`
 * rather than losing precision to cancellation earlier. Below that, `k = 0` exactly is used
 * instead (the limit above, computed directly with no division at all) — "clamp with an exact
 * flat endpoint", not a Taylor series, since the animation only ever approaches `k = 0` from
 * above and settles there exactly (never lingers at some tiny nonzero `k` a series would need to
 * cover).
 */
function curvatureUnroll(x: number, y: number, k: number): readonly [number, number, number] {
  if (k < CURVATURE_EPSILON) return [x, y, 1]
  const xk = x * k
  const yk = y * k
  return [(Math.sin(xk) * Math.cos(yk)) / k, Math.sin(yk) / k, (Math.cos(xk) * Math.cos(yk) - 1) / k + 1]
}

/** The outward direction at `(x, y, k)`'s own point on `curvatureUnroll`'s sphere of radius
 *  `1/k` centred at `(0, 0, 1 - 1/k)` — radial on the sphere (`k = 1`: exactly the point itself,
 *  already unit length), continuously flattening to a constant `(0, 0, 1)` as `k -> 0` (every
 *  normal on a flat plane facing the camera points the same way). `unfoldedLiftedPosition`'s
 *  "which way is up" for a lift that must stay perpendicular to the actual surface at every
 *  `unfold`, not just at the two endpoints. */
function curvatureNormal(x: number, y: number, k: number): readonly [number, number, number] {
  if (k < CURVATURE_EPSILON) return [0, 0, 1]
  const [px, py, pz] = curvatureUnroll(x, y, k)
  const centerZ = 1 - 1 / k
  return normalize3([px, py, pz - centerZ])
}

/** Both flat-projection coordinates blended by `unfold` (`s`): equirectangular (`lonLatToSphere`'s
 *  own angle inputs) toward Equal Earth's own `(x, y)` at `radius = 1` — see this module's doc
 *  comment for why these, not the two functions' xyz *output*, are what gets blended. */
function unrolledXY(point: GlobeEffectAnchor, s: number): readonly [number, number] {
  const lambda = point.lon * DEG2RAD
  const phi = point.lat * DEG2RAD
  const [mapX, mapY] = lonLatToMap(point, 1)
  return [lambda + (mapX - lambda) * s, phi + (mapY - phi) * s]
}

/** `lonLatToSphere` and `lonLatToMap` joined by the curvature unroll above, `unfold` (0 = sphere,
 *  1 = map, clamped) driving both the coordinate blend and curvature `k = 1 - unfold`. What
 *  `GLOBE_VERTEX_SHADER` computes per-vertex every frame (via `PROJECTION_GLSL`'s own twin,
 *  `unfoldedPosition`) — exported here for CPU-side callers (`GlobeTooltip.tsx`'s hit test;
 *  `poles.ts`'s stub/label markers fade out over the same span rather than call this, per
 *  `Globe.tsx`'s own doc comment on why). */
export function unfoldedPosition(point: GlobeEffectAnchor, unfold: number, radius = 1): readonly [number, number, number] {
  const s = clamp01(unfold)
  const [x, y] = unrolledXY(point, s)
  const [ux, uy, uz] = curvatureUnroll(x, y, 1 - s)
  return [ux * radius, uy * radius, uz * radius]
}

/**
 * `unfoldedPosition`, but for an overlay drawn slightly *above* the surface (arrival arcs and
 * their markers, `HumanCivilisation.tsx`/`MarkerField.tsx`) — the lift needs different treatment in each mode, so it
 * cannot be expressed as a single `radius` passed through to `unfoldedPosition` the way a plain
 * inflated radius would. On the sphere, "above the surface" is a *radial* lift (`sphereLift`, a
 * fraction of `radius`); on the map, which is flat, there is no "radial" direction to lift along,
 * so the equivalent is a small constant `+z` offset toward the camera (`mapZOffset`), applied
 * *without* also scaling the map's own `x`/`y` (which would inflate them by the same fraction as
 * the lift — a real, if small, position error: a marker's lat/lon would no longer land where the
 * map itself puts that lat/lon). `curvatureNormal` gives "which way is up" continuously across
 * the whole unroll, so both fractions blend smoothly into a single lift *amount* (`sphereLift` at
 * `unfold = 0`, `mapZOffset` at `unfold = 1`) along that one direction, rather than lifting two
 * unrelated positions and lerping the results. */
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
 * The unrolled mesh's own bounding half-width/half-height at a given `unfold`, at `radius = 1`
 * — `Globe.tsx`'s `GlobeCameraControls` scales these by `GLOBE_RADIUS` to size its map-mode
 * camera fit against the mesh's *actual* current silhouette rather than a linear lerp between
 * the sphere's and the map's own half-extents. That lerp was the other half of the "jump" this
 * module's own doc comment describes (`scratchpad/transition-*`, browser-verified): the real
 * curvature-unrolled silhouette does not grow from a circle to a rectangle at a uniform rate —
 * for roughly the first half of the unroll (`unfold` up to where the equator's widest point
 * stops sitting at an *interior* longitude and moves to the map's own edge, `lon = ±180`; solving
 * for where that crossover happens isn't needed here since sampling finds the true maximum
 * either way) the sphere's own curvature still dominates the silhouette and a lerp toward the
 * far larger final map width overshoots it — so a camera sized against the lerp was briefly too
 * far back, then had to visibly race the mesh's real (slower-growing at first) width to catch up,
 * reading as a shrink-then-grow "jump" over the same span the facets above were visible in.
 * Numeric sampling (not a closed form) sidesteps re-deriving that crossover by hand: it finds
 * the true maximum however the silhouette actually varies, at either endpoint or in between.
 *
 * Height needs no equivalent search: `unfoldedPosition`'s `y` is a function of latitude alone
 * (`unrolledXY`'s `y` never depends on longitude, and neither does `curvatureUnroll`'s middle
 * term), and stays monotonic in latitude for every `unfold` in this mesh's domain (the argument
 * to the height formula's own `sin` never exceeds `pi/2` — both the equirectangular and Equal
 * Earth half-heights are at most `pi/2` radians, and curvature `k <= 1` only ever shrinks that
 * product further), so the pole alone (`lat = 90`) is always the true maximum. It is still swept
 * here (not read off as a single evaluation) so a future change to either endpoint's own extent
 * can't silently invalidate that reasoning without also changing this function's own output.
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
 * `GLOBE_VERTEX_SHADER` (`shaders.ts`) and the human layer's own arc/marker vertex shaders, all of
 * which need the same mapping on the GPU. Every numeric constant is interpolated from the TS
 * values above rather than retyped, so the two implementations cannot drift; `projection.test.ts`
 * still pins them (a regression net against a hand-edited literal, not the only thing preventing
 * drift). Always at `radius = 1` — GLSL callers scale via the mesh's own transform (`Globe.tsx`'s
 * `<mesh scale={GLOBE_RADIUS}>`), the same choice the TS functions' own `radius = 1` default
 * makes for their callers.
 */
export const PROJECTION_GLSL = /* glsl */ `
const float EE_A1 = ${glslFloat(EQUAL_EARTH_A1)};
const float EE_A2 = ${glslFloat(EQUAL_EARTH_A2)};
const float EE_A3 = ${glslFloat(EQUAL_EARTH_A3)};
const float EE_A4 = ${glslFloat(EQUAL_EARTH_A4)};
const float EE_M = ${glslFloat(EQUAL_EARTH_M)};
const float EE_DEG2RAD = ${glslFloat(DEG2RAD)};

// lonLatDeg: x = lon, y = lat, both in degrees. Lon 0 faces +Z — see the TS twin's own doc
// comment (lonLatToSphere, above) for why this axis choice (and the winding it must keep
// matching) is load-bearing, not arbitrary.
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

// curvatureUnroll/unfoldedPosition: the TS twin's own doc comment (above) has the full
// derivation and the endpoint proof (k=1 is exactly lonLatToSphere, k->0 is exactly the flat
// plane z=1, (0,0) sits at z=1 for every k). z is written as (cos(xk)*cos(yk)-1)/k + 1, not
// cos(xk)*cos(yk)/k - 1/k + 1, for the same cancellation reason as the TS twin.
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

// curvatureNormal/unfoldedLiftedPosition: the TS twin's own doc comment (above) explains the
// single blended lift amount along one continuously-turning direction, at radius = 1 (GLSL
// callers — the human layer's own arc ribbon and marker shaders — scale via the mesh's own transform, the
// same convention every other function here follows).
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
 * Splits a lon/lat polyline into pieces that never cross the ±180° seam, inserting a point
 * exactly at the seam (latitude linearly interpolated) on each side of a crossing so the two
 * resulting pieces still reach the map's edge rather than leaving a visible gap. Used by
 * `arcs.ts`'s `buildArrivalArcGeometry`: a path drawn straight across the *sphere* is continuous,
 * but drawn straight across the flattened Equal Earth *map* it would stretch across the whole
 * width unless split here first — the same seam problem `globeGeometry.ts` solves for the base
 * mesh, but for arbitrary point sequences rather than a fixed lon/lat grid.
 *
 * Generic over `T` so a caller can attach extra per-point data and have it survive the split,
 * including through the two seam points this function itself synthesizes — `arcs.ts` attaches a
 * cumulative "distance along the whole (pre-split) arc" field, so a dash pattern stays continuous
 * across a split rather than restarting at 0 on each piece as if every piece were its own
 * full-length arc. `interpolateExtra(prev, curr, f)` computes that
 * extra data for a synthesized seam point at fraction `f` between `prev` and `curr` — the same
 * `f` latitude is interpolated by. Omitted (the default), a seam point carries no fields beyond
 * `lon`/`lat`, exactly this function's original, still-generic-free behaviour.
 *
 * `points.length <= 1` returns the input as a single segment (nothing to split).
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
      // The shorter path crosses ±180° rather than 0°. `goingEast` means the path is heading
      // from just under +180 to just over -180 (wrapping east-to-west numerically).
      const goingEast = delta < 0
      const seamPrevLon = goingEast ? 180 : -180
      const seamCurrLon = goingEast ? -180 : 180
      // Unwrap curr's longitude onto the same continuous number line as prev so the seam
      // latitude below is a plain linear interpolation, exact for the straight-line paths this
      // helper is meant for (event arcs, not great circles).
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
