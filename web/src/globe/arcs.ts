/**
 * Pure geometry and state for human-dispersal arrival arcs (ADR-032). No
 * three.js, no React — the same "pure core, thin three.js/React consumer" split `blend.ts`,
 * `globeGeometry.ts` and `camera.ts` all follow; `HumanCivilisation.tsx` is the thin consumer.
 *
 * **Shown whole, never grown along its length.** The arc's *geometry*
 * (`greatCircleLonLatPoints`) never depends on `t` at all — animating draw progress from `t`
 * within the dating-uncertainty band would repeat ADR-022's "seaweed" mistake of reading dating
 * uncertainty as travel time. What `t` drives is the arc's *presence*: `arrivalPresentationAt`
 * below turns `t` into an alpha, a travel progress, a landing ripple and an "inhabited" weight
 * that itself rises then fades, and nothing else.
 *
 * **Transient, not permanent (2026-09 human-civilisation pass; further amended 2026-09 so the
 * "inhabited" marker fades too).** Every arc used to be drawn for all `t` at or below its
 * window's `tMax`, so by the present all 25 were on screen at once. An arc is now drawn only
 * while its migration is happening — from the window's `tMax` through `established` — then
 * fades out over a tail. A `peopling` arrival leaves a small "inhabited" marker at its
 * destination once it lands, which itself fades out once the whole arrival has read as an event
 * that happened, rather than sitting on the globe forever (a `migration` leaves nothing, at any
 * point). Everything here stays a pure function of `t` — a fade-out driven by wall-clock state
 * would break scrubbing backwards through an already-faded arrival.
 */

import { EARTH_FORMATION } from '@/types/layer'
import type { ArrivalGlobeEffect, GeoTime, GlobeEffectAnchor, TimelineEvent } from '@/types/layer'

import { clamp01, smoothstep as easeSmoothstep, symlogWarp } from './effects/math'
import { lonLatToSphere, splitAtAntimeridian } from './projection'

const RAD2DEG = 180 / Math.PI

/** Below this angular separation (radians) an "arc" is treated as a point — the one curated
 *  degenerate arrival, origin === destination (the Africa origin, ADR-032) — rather than a
 *  zero-length or numerically unstable great-circle interpolation. */
const DEGENERATE_ANGLE_RADIANS = 1e-6

function dot3(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

/**
 * `segments + 1` points along the great-circle path from `origin` to `destination`, evenly
 * spaced in angle (spherical linear interpolation of the two points' unit vectors,
 * `lonLatToSphere`) — the shorter of the two possible great-circle paths, same as every
 * standard great-circle interpolation. Returns a single-point array (just `origin`) for the
 * degenerate origin === destination case, so a caller can detect "point, not arc" without a
 * separate check (`isDegenerate` below spells this out explicitly instead of relying on
 * `.length === 1`, since a 1-point return could otherwise read as a bug).
 */
export function greatCircleLonLatPoints(
  origin: GlobeEffectAnchor,
  destination: GlobeEffectAnchor,
  segments: number,
): GlobeEffectAnchor[] {
  const a = lonLatToSphere(origin)
  const b = lonLatToSphere(destination)
  const theta = Math.acos(clamp(dot3(a, b), -1, 1))
  if (theta < DEGENERATE_ANGLE_RADIANS) return [origin]

  const sinTheta = Math.sin(theta)
  const points: GlobeEffectAnchor[] = []
  for (let i = 0; i <= segments; i++) {
    const f = i / segments
    const wa = Math.sin((1 - f) * theta) / sinTheta
    const wb = Math.sin(f * theta) / sinTheta
    const x = a[0] * wa + b[0] * wb
    const y = a[1] * wa + b[1] * wb
    const z = a[2] * wa + b[2] * wb
    const len = Math.hypot(x, y, z)
    const lat = Math.asin(clamp(y / len, -1, 1)) * RAD2DEG
    // Inverts lonLatToSphere's own x = cos(lat)*sin(lon), z = cos(lat)*cos(lon) (projection.ts's
    // doc comment on why lon 0 faces +Z) — atan2(x, z), the standard atan2(opposite, adjacent)
    // recovery of an angle from its own sin/cos.
    const lon = Math.atan2(x / len, z / len) * RAD2DEG
    points.push({ lat, lon })
  }
  return points
}

/** Whether `effect` is the degenerate origin === destination case (ADR-032's Africa origin): a
 *  point marker, not a line — checked on the curated anchors directly rather than inferred from
 *  `greatCircleLonLatPoints`'s output length, so the two stay independently meaningful. */
export function isDegenerateArrival(effect: ArrivalGlobeEffect): boolean {
  return effect.origin.lat === effect.destination.lat && effect.origin.lon === effect.destination.lon
}

/** The one `windows` entry that reaches the present — the arc's actual visible span.
 *  `pipeline.shapes.ArrivalEffect` and `web/src/data/curated.ts`'s own parser both validate
 *  that every `ArrivalGlobeEffect` has *exactly* one window with `tMin === 0` before it ever
 *  reaches this function, so a plain `find` is safe: there is exactly one to find. */
function persistentWindow(effect: ArrivalGlobeEffect): { tMin: GeoTime; tMax: GeoTime } {
  const found = effect.windows.find((w) => w.tMin === 0)
  if (found === undefined) {
    throw new Error(`arrival effect has no window with tMin === 0 — this should have been rejected at parse time`)
  }
  return found
}

// --------------------------------------------------------------------------- transient timing

/**
 * How long, in wall-clock seconds at the timeline's own default playback rate, one arrival must
 * stay on screen in total (travel plus fade-out tail) and how long its tail alone must last.
 *
 * These are seconds, but nothing here reads a clock: `arrivalTimingFor` converts them *once*,
 * statically, into widths in the timeline's own warped space, and `arrivalPresentationAt` is
 * then a pure function of `t` alone. Sizing the tail in warp rather than in years is what makes
 * the guarantee hold at every era — playback moves at constant velocity in warped space
 * (`timeline/playback.ts`), so a constant warp width *is* a constant number of seconds, whereas
 * a fixed year count would be a flicker at 60 ka and an eternity at 700 BP.
 *
 * Consequence worth knowing: near the present the whole remaining timeline is narrower than
 * `MIN_ARC_SECONDS` of warp, so an arrival established a few hundred years ago cannot be given
 * its full tail — its fade simply runs out of timeline and it is still partly drawn at `t = 0`.
 * That is the honest floor (there is no more time to give it), not a missing clamp.
 */
const MIN_ARC_SECONDS = 1.1
const MIN_TAIL_SECONDS = 0.4
/** Half-width of the landing ripple / inhabited-marker ease either side of `established`. */
const LANDING_SECONDS = 0.45
/** Width, past the landing above, over which the "inhabited" marker fades back out — so a
 *  `peopling` arrival reads as an event that happens and passes rather than leaving a permanent
 *  mark (2026-09 user feedback: "I don't think it makes sense for them to persist forever"). Same
 *  "runs out of timeline near the present" honest floor as `MIN_ARC_SECONDS` above applies here
 *  too: a `peopling` arrival established only a few hundred or thousand years ago (Iceland,
 *  Aotearoa, Rapa Nui, Greenland, Madagascar) has less real-year timeline left between its
 *  `established` and `t = 0` than this width needs, so its marker is still partway through fading
 *  — sometimes barely faded at all — at the present. Older peopling arrivals (Beringia, the
 *  Levant, ≳4 ka) have ample timeline and fade to exactly 0 well before `t = 0`. */
const INHABITED_FADE_SECONDS = 0.8

/** The arrival timing widths, in symlog-warp units — see `MIN_ARC_SECONDS`'s doc comment. */
export interface ArrivalTiming {
  minArcWarp: number
  minTailWarp: number
  landingWarp: number
  inhabitedFadeWarp: number
}

/** The full domain's own warp span. `baseRate` is screen-space units per second across that
 *  whole span (`Playback.baseRate`), so `baseRate * FULL_DOMAIN_WARP` is warp per second. */
const FULL_DOMAIN_WARP = symlogWarp(EARTH_FORMATION)

/**
 * Converts the seconds above into warp widths using the timeline's own playback-rate model:
 * `baseRate` screen units per second at 1× speed, over a full domain `FULL_DOMAIN_WARP` wide.
 * Computed once per `baseRate`, never per frame, and never from a clock.
 */
export function arrivalTimingFor(baseRate: number): ArrivalTiming {
  const warpPerSecond = Math.max(0, baseRate) * FULL_DOMAIN_WARP
  return {
    minArcWarp: MIN_ARC_SECONDS * warpPerSecond,
    minTailWarp: MIN_TAIL_SECONDS * warpPerSecond,
    landingWarp: LANDING_SECONDS * warpPerSecond,
    inhabitedFadeWarp: INHABITED_FADE_SECONDS * warpPerSecond,
  }
}

/** Everything `t` decides about one arrival. Every field is a pure function of `t` (plus the
 *  statically-derived `ArrivalTiming`) — nothing here may depend on how `t` was reached. */
export interface ArrivalPresentation {
  /** How strongly the arc itself is drawn, 0 (not drawn at all) .. 1. */
  arcAlpha: number
  /** Whether the migration is currently happening — `t` inside `[established, tMax]`. */
  travelling: boolean
  /** 0 at the window's `tMax`, 1 at `established` and after. The share of the migration that has
   *  elapsed at `t`; the travelling pulse's own position along the arc is a separate, wall-clock
   *  loop (see `HumanCivilisation.tsx`) so it stays legible at any scrub speed. */
  travelProgress: number
  /** How far the arrival has settled at its destination: 0 at `established` and while still
   *  travelling, easing to 1 a `landingWarp` past it. The landing ripple expands and fades across
   *  this span; the "inhabited" marker below fades in over it. */
  settleProgress: number
  /** The "inhabited" marker's weight at the destination, 0 .. 1: fades in as the arrival settles
   *  (tracking `settleProgress`), then fades back out over `inhabitedFadeWarp` once it has —
   *  it does not persist to the present, so the arrival reads as an event that happened and
   *  passed rather than a permanent mark. Always 0 for a `migration` (ADR-032 amendment: only
   *  first settlement leaves one behind, however briefly). */
  inhabited: number
}

const HIDDEN_ARRIVAL: ArrivalPresentation = {
  arcAlpha: 0,
  travelling: false,
  travelProgress: 0,
  settleProgress: 0,
  inhabited: 0,
}

/**
 * The arrival's presentation at `t`. Hidden above the window's own `tMax` (the arrival hasn't
 * happened yet on any defensible dating); drawn at full strength while `t` runs from `tMax` down
 * to `established`; then faded out across a tail wide enough that the whole appearance lasts at
 * least `MIN_ARC_SECONDS` at the default playback rate.
 *
 * `established` stays a hard *dating* fact — it is where the travel ends and the tail begins, not
 * a value blended across — but the arc's own opacity either side of it is continuous, so an arc
 * never pops out mid-flight.
 */
export function arrivalPresentationAt(effect: ArrivalGlobeEffect, t: GeoTime, timing: ArrivalTiming): ArrivalPresentation {
  const window = persistentWindow(effect)
  if (t > window.tMax) return HIDDEN_ARRIVAL

  const startWarp = symlogWarp(window.tMax)
  const establishedWarp = symlogWarp(effect.established)
  const currentWarp = symlogWarp(t)
  const travelWarp = Math.max(0, startWarp - establishedWarp)
  const tailWarp = Math.max(timing.minTailWarp, timing.minArcWarp - travelWarp)

  const travelling = t >= effect.established
  const travelProgress = travelling && travelWarp > 0 ? clamp01((startWarp - currentWarp) / travelWarp) : 1
  const arcAlpha = travelling ? 1 : clamp01(tailWarp > 0 ? (currentWarp - (establishedWarp - tailWarp)) / tailWarp : 0)

  const distancePastEstablished = establishedWarp - currentWarp
  const settleProgress = easeSmoothstep(0, timing.landingWarp, distancePastEstablished)
  // Fades out starting only once settleProgress has fully risen (distancePastEstablished >=
  // landingWarp), so the marker never starts disappearing before it has finished appearing.
  const inhabitedFadeOut = easeSmoothstep(
    timing.landingWarp,
    timing.landingWarp + timing.inhabitedFadeWarp,
    distancePastEstablished,
  )
  const inhabited = effect.arrivalKind === 'peopling' ? settleProgress * (1 - inhabitedFadeOut) : 0

  return { arcAlpha, travelling, travelProgress, settleProgress, inhabited }
}

/** Whether `t` is anywhere inside any arrival's own visible span — the "Human civilisation"
 *  legend row reads this alongside the density and city equivalents. Reuses
 *  `arrivalPresentationAt` rather than re-deriving the rule a second way. */
export function hasVisibleArrivals(events: readonly TimelineEvent[], t: GeoTime, timing: ArrivalTiming): boolean {
  for (const event of events) {
    if (event.effect === undefined || event.effect.kind !== 'arrival') continue
    const presentation = arrivalPresentationAt(event.effect, t, timing)
    if (presentation.arcAlpha > 0 || presentation.inhabited > 0) return true
  }
  return false
}

/** The arrival's own visible window, `[established, tMax]` in `TimeWindow`'s `[newest, oldest]`
 *  ordering — what the tooltip prints through `@/timeline`'s `formatTimeRange`. */
export function arrivalWindow(effect: ArrivalGlobeEffect): readonly [GeoTime, GeoTime] {
  return [effect.established, persistentWindow(effect).tMax]
}

/** A lon/lat point carrying its own cumulative progress (0 at `origin`, 1 at `destination`)
 *  along the *whole* pre-split arc — `ArrivalArcGeometry.segments`' own point type, so a split
 *  piece's dash pattern (`HumanCivilisation.tsx`'s `ARC_FRAGMENT_SHADER`) can pick up exactly where the
 *  piece before it left off rather than restarting at 0 (docs/GLOBE.md §10). */
export interface DistancedAnchor extends GlobeEffectAnchor {
  distance: number
}

/** `splitAtAntimeridian`, carrying `distance` through a synthesized seam point by linearly
 *  interpolating it the same way latitude already is (the same fraction `f`) — `points` are
 *  evenly spaced in great-circle angle (`greatCircleLonLatPoints`'s own doc comment), so a
 *  cumulative-progress field is exactly the kind of "changes smoothly along the path" data that
 *  interpolation is valid for, unlike lon/lat themselves near the seam. */
function splitArcAtAntimeridian(points: readonly DistancedAnchor[]): DistancedAnchor[][] {
  return splitAtAntimeridian(points, (prev, curr, f) => ({ distance: prev.distance + (curr.distance - prev.distance) * f }))
}

/** One arc's static (t-independent) geometry — built once and reused, never rebuilt per frame.
 *  `segments` splits at the antimeridian (`splitArcAtAntimeridian`) so a map-mode arc crossing it
 *  (Beringia to the Americas) draws as two pieces rather than streaking across the whole map
 *  width. */
export interface ArrivalArcGeometry {
  eventId: string
  effect: ArrivalGlobeEffect
  isDegenerate: boolean
  /** Empty for a degenerate (point-marker) arrival. Each inner array is one antimeridian-safe
   *  polyline segment; a non-crossing arc is a single segment holding every point. Each point's
   *  own `distance` is cumulative across the *whole* arc, not reset per segment (docs/GLOBE.md
   *  §10) — `buildFatLineBuffers` passes it straight through to `ArcSegment`'s dash pattern
   *  unchanged. */
  segments: DistancedAnchor[][]
}

const ARC_SEGMENTS = 48

export function buildArrivalArcGeometry(eventId: string, effect: ArrivalGlobeEffect): ArrivalArcGeometry {
  const isDegenerate = isDegenerateArrival(effect)
  if (isDegenerate) return { eventId, effect, isDegenerate, segments: [] }
  const points = greatCircleLonLatPoints(effect.origin, effect.destination, ARC_SEGMENTS)
  // Evenly spaced in angle by construction (greatCircleLonLatPoints's own doc comment), so
  // point i's cumulative progress along the whole arc is exactly i / (points.length - 1) — no
  // separate arc-length computation needed. `points.length` is normally `ARC_SEGMENTS + 1`, but
  // guarded to 1 below for the theoretical near-degenerate single-point case (theta just above
  // DEGENERATE_ANGLE_RADIANS), matching buildFatLineBuffers's own former `n > 1 ? ... : 0` guard.
  const distanceDenominator = Math.max(points.length - 1, 1)
  const distancedPoints: DistancedAnchor[] = points.map((p, i) => ({ ...p, distance: i / distanceDenominator }))
  return { eventId, effect, isDegenerate, segments: splitArcAtAntimeridian(distancedPoints) }
}

// ------------------------------------------------------------------------- the arrival chain

/** One arrival, ready to render and to trace: its geometry, the event it came from (for the
 *  tooltip and the event-feed pulse), and the arrival it continues from. */
export interface ArrivalRecord {
  eventId: string
  event: TimelineEvent
  effect: ArrivalGlobeEffect
  geometry: ArrivalArcGeometry
  /** The older arrival whose destination this one set out from — `null` for the African origin
   *  itself, which is where every chain ends (`traceToOrigin`). */
  parentEventId: string | null
}

export interface ArrivalIndex {
  /** Ascending by `established` — i.e. newest arrival first, oldest (the origin) last. */
  records: readonly ArrivalRecord[]
  byEventId: ReadonlyMap<string, ArrivalRecord>
}

/** Great-circle separation of two anchors, in radians. */
function angularDistance(a: GlobeEffectAnchor, b: GlobeEffectAnchor): number {
  const [ax, ay, az] = lonLatToSphere(a)
  const [bx, by, bz] = lonLatToSphere(b)
  return Math.acos(clamp(ax * bx + ay * by + az * bz, -1, 1))
}

/**
 * Which older arrival a given arrival continues from: the one whose *destination* sits nearest
 * this arrival's *origin*, among arrivals established strictly earlier (larger `t`).
 *
 * Derived rather than curated because the data does not carry an explicit parent link, and the
 * derivation is unambiguous on the curated set: the origins are schematic region centroids
 * chosen to sit at or very near the destination they set out from (nine of the twenty-five match
 * an ancestor's destination exactly; the widest genuine hop is Beringia's 27° from East Asia, and
 * the runner-up is always further). Ties break on `eventId` so the chain is deterministic.
 *
 * The "strictly older" requirement is what makes the parent relation a DAG — every chain
 * terminates, and `traceToOrigin` cannot loop.
 */
function findParentEventId(record: { eventId: string; effect: ArrivalGlobeEffect }, all: readonly ArrivalRecord[]): string | null {
  if (isDegenerateArrival(record.effect)) return null
  let bestId: string | null = null
  let bestDistance = Infinity
  for (const other of all) {
    if (other.eventId === record.eventId) continue
    if (other.effect.established <= record.effect.established) continue
    const distance = angularDistance(record.effect.origin, other.effect.destination)
    if (distance < bestDistance || (distance === bestDistance && bestId !== null && other.eventId < bestId)) {
      bestDistance = distance
      bestId = other.eventId
    }
  }
  return bestId
}

/** Every arrival in `events`, with geometry built once and its parent link resolved — the single
 *  call `HumanCivilisation.tsx` memoises per manifest load, never per frame. */
export function buildArrivalIndex(events: readonly TimelineEvent[]): ArrivalIndex {
  const records: ArrivalRecord[] = []
  for (const event of events) {
    if (event.effect === undefined || event.effect.kind !== 'arrival') continue
    records.push({
      eventId: event.id,
      event,
      effect: event.effect,
      geometry: buildArrivalArcGeometry(event.id, event.effect),
      parentEventId: null,
    })
  }
  records.sort((a, b) => a.effect.established - b.effect.established || a.eventId.localeCompare(b.eventId))
  for (const record of records) {
    record.parentEventId = findParentEventId(record, records)
  }
  return { records, byEventId: new Map(records.map((r) => [r.eventId, r])) }
}

/** The chain of arrivals that led to `eventId`, `eventId` first and the African origin last.
 *  Empty for an unknown id. */
export function traceToOrigin(index: ArrivalIndex, eventId: string): string[] {
  const chain: string[] = []
  let current = index.byEventId.get(eventId)
  while (current !== undefined) {
    chain.push(current.eventId)
    current = current.parentEventId === null ? undefined : index.byEventId.get(current.parentEventId)
  }
  return chain
}

// ------------------------------------------------------------------- fat-line ribbon geometry

/**
 * Per-vertex buffers for a screen-space-constant-width ribbon along `points` — a fat line, not a
 * `gl.LINE_STRIP` (which every mainstream WebGL backend clamps to one device pixel regardless of
 * `gl.lineWidth`). Two vertices per point (`aSide = -1`/`+1`), expanded perpendicular to the
 * *screen-space* tangent direction in
 * the vertex shader (`HumanCivilisation.tsx`'s `ARC_VERTEX_SHADER`) — this function only supplies the
 * per-point data the shader needs to compute that tangent consistently, not the tangent itself
 * (screen-space direction depends on the live camera, so it can't be precomputed here).
 *
 * `aDirA`/`aDirB` are the point's own immediate neighbours (clamped at the arc's own ends, so
 * the first/last point's tangent is a one-sided estimate rather than undefined) — both `aSide`
 * copies of a given point index share the *same* `aDirA`/`aDirB` pair, so the ribbon's tangent
 * at that index is identical regardless of which of the two quads sharing it is being drawn,
 * avoiding a visible seam/kink at the joint between segments.
 *
 * `distance` is read straight from each point's own `DistancedAnchor.distance`, not recomputed
 * as a local `i / (n - 1)` fraction of *this* array alone — `points` here is one antimeridian
 * split piece, and a piece-local fraction would restart the dash pattern at 0 on every piece and
 * stretch/compress its density to that piece's own length. Carrying a cumulative, whole-arc
 * distance through the split in the first place (`buildArrivalArcGeometry`/
 * `splitArcAtAntimeridian` above) is what keeps a crossing arc's dash pattern continuous.
 */
export interface FatLineBuffers {
  /** `(lon, lat)` per vertex, 2 floats each, length `points.length * 2 * 2`. */
  lonLat: Float32Array
  dirA: Float32Array
  dirB: Float32Array
  /** -1 or +1 per vertex, length `points.length * 2`. */
  side: Float32Array
  /** 0..1 progress along the *whole* arc (not just this piece), shared by both `aSide` copies
   *  of a point. */
  distance: Float32Array
  /** Two triangles per segment between consecutive points. */
  indices: Uint32Array
}

export function buildFatLineBuffers(points: readonly DistancedAnchor[]): FatLineBuffers {
  const n = points.length
  const lonLat = new Float32Array(n * 2 * 2)
  const dirA = new Float32Array(n * 2 * 2)
  const dirB = new Float32Array(n * 2 * 2)
  const side = new Float32Array(n * 2)
  const distance = new Float32Array(n * 2)

  for (let i = 0; i < n; i++) {
    const p = points[i]!
    const a = points[Math.max(i - 1, 0)]!
    const b = points[Math.min(i + 1, n - 1)]!
    for (let side_ = 0; side_ < 2; side_++) {
      const vi = i * 2 + side_
      lonLat[vi * 2] = p.lon
      lonLat[vi * 2 + 1] = p.lat
      dirA[vi * 2] = a.lon
      dirA[vi * 2 + 1] = a.lat
      dirB[vi * 2] = b.lon
      dirB[vi * 2 + 1] = b.lat
      side[vi] = side_ === 0 ? -1 : 1
      distance[vi] = p.distance
    }
  }

  const indices: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const l0 = i * 2
    const r0 = i * 2 + 1
    const l1 = (i + 1) * 2
    const r1 = (i + 1) * 2 + 1
    indices.push(l0, l1, r0, l1, r1, r0)
  }

  return { lonLat, dirA, dirB, side, distance, indices: Uint32Array.from(indices) }
}

// --------------------------------------------------------------------- marker visibility (limb)

/** How far past the true horizon (as a fraction of the threshold cosine) the fade starts —
 *  mirrors `poles.ts`'s own `POLE_VISIBILITY_MARGIN` derivation but widened into a smoothed
 *  band rather than a hard cutoff, so a marker lifted slightly above the surface never visibly
 *  "floats" past the sphere's true silhouette the way a boolean visible/hidden test does right
 *  at the limb. */
const MARKER_FADE_BAND = 0.12

/**
 * Smooth 0..1 visibility of a point on the sphere's surface (`direction`, a unit vector — the
 * caller passes the marker's live *world*-space direction from the sphere's centre, already
 * reflecting any auto-rotation the sphere's own rotating group applies, since it reads the
 * marker's actual `Object3D.getWorldPosition` rather than an unrotated local one) as seen by a
 * camera at `cameraPosition`, `sphereRadius` units from the sphere's centre — same derivation as
 * `poles.ts`'s `isPoleVisible` (`dot(cameraPosition, direction) >= sphereRadius` at the true
 * horizon), but returned as a smoothstep fade across `MARKER_FADE_BAND` around that threshold
 * rather than a boolean, and combined with ordinary WebGL depth-testing in the caller
 * (`GlobeTooltip.tsx`'s own hit test) rather than replacing it — belt and braces, since depth-testing alone
 * leaves a billboard quad ambiguous exactly at the limb where near- and far-surface depth
 * converge.
 */
export function sphereMarkerVisibility(
  direction: readonly [number, number, number],
  cameraPosition: readonly [number, number, number],
  sphereRadius: number,
): number {
  const [dx, dy, dz] = direction
  const [cx, cy, cz] = cameraPosition
  const cameraDistance = Math.hypot(cx, cy, cz)
  if (cameraDistance === 0) return 0
  const cosAngle = (dx * cx + dy * cy + dz * cz) / cameraDistance
  const threshold = sphereRadius / cameraDistance
  return easeSmoothstep(threshold - MARKER_FADE_BAND, threshold + MARKER_FADE_BAND, cosAngle)
}
