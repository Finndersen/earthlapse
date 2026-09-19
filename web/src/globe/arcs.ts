/**
 * Pure geometry and state for human-dispersal arrival arcs (ADR-032). No three.js, no React —
 * same "pure core, thin consumer" split as `blend.ts`/`globeGeometry.ts`/`camera.ts`;
 * `HumanCivilisation.tsx` is the thin consumer.
 *
 * The arc's *points* (`greatCircleLonLatPoints`) never depend on `t` — built once from
 * `origin`/`destination` alone. What depends on `t` is how much of that fixed shape is drawn:
 * `arrivalPresentationAt`'s `travelProgress` (0 at the window's `tMax`, 1 at `established`) is a
 * reveal fraction against each point's cumulative `DistancedAnchor.distance`, so the ribbon draws
 * progressively toward destination, arrowhead at the leading edge. The `[established, tMax]` span
 * is a dating-uncertainty band, not a measured journey duration — animating it as travel time is
 * a deliberate product choice (ADR-032 amendment, recorded in docs/DECISIONS.md). Every field of
 * `ArrivalPresentation` is a pure function of `t`, so scrubbing reproduces the same reveal.
 *
 * An arc is drawn only while its migration is happening — from `tMax` through `established` —
 * then fades over a tail; a `peopling` arrival also leaves a small "inhabited" marker that itself
 * fades back out, so nothing sits on the globe permanently (`migration` leaves nothing). The fade
 * is a pure function of `t`, not wall-clock state, so scrubbing backwards stays correct.
 */

import { EARTH_FORMATION } from '@/types/layer'
import type { ArrivalGlobeEffect, GeoTime, GlobeEffectAnchor, TimelineEvent } from '@/types/layer'

import { clamp01, smoothstep as easeSmoothstep, symlogWarp } from './effects/math'
import { lonLatToSphere, splitAtAntimeridian } from './projection'

const RAD2DEG = 180 / Math.PI

/** Below this angular separation (radians) an "arc" is treated as a point (the Africa origin,
 *  ADR-032, where origin === destination) rather than a zero-length/unstable great-circle interpolation. */
const DEGENERATE_ANGLE_RADIANS = 1e-6

function dot3(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x))
}

/** The two endpoints' unit vectors and their great-circle angular separation, shared by every
 *  point sampled along one arc (both `greatCircleLonLatPoints`'s fixed grid and
 *  `arrowheadPlacementAt`'s arbitrary fraction). */
interface GreatCircleBasis {
  a: readonly [number, number, number]
  b: readonly [number, number, number]
  theta: number
  sinTheta: number
}

function greatCircleBasis(origin: GlobeEffectAnchor, destination: GlobeEffectAnchor): GreatCircleBasis {
  const a = lonLatToSphere(origin)
  const b = lonLatToSphere(destination)
  const theta = Math.acos(clamp(dot3(a, b), -1, 1))
  return { a, b, theta, sinTheta: Math.sin(theta) }
}

/** The point at fraction `f` (0 at `origin`, 1 at `destination`) of `basis`'s great circle —
 *  spherical linear interpolation of the two endpoints' unit vectors (the shorter path). Every
 *  caller must check `basis.theta` is non-degenerate first, or `basis.sinTheta` is ~0. */
function pointAtBasis(basis: GreatCircleBasis, f: number): GlobeEffectAnchor {
  const { a, b, theta, sinTheta } = basis
  const wa = Math.sin((1 - f) * theta) / sinTheta
  const wb = Math.sin(f * theta) / sinTheta
  const x = a[0] * wa + b[0] * wb
  const y = a[1] * wa + b[1] * wb
  const z = a[2] * wa + b[2] * wb
  const len = Math.hypot(x, y, z)
  const lat = Math.asin(clamp(y / len, -1, 1)) * RAD2DEG
  // Inverts lonLatToSphere's x = cos(lat)*sin(lon), z = cos(lat)*cos(lon) (lon 0 faces +Z, see projection.ts).
  const lon = Math.atan2(x / len, z / len) * RAD2DEG
  return { lat, lon }
}

/**
 * `segments + 1` points along the great-circle path from `origin` to `destination`, evenly
 * spaced in angle. Returns a single-point array (just `origin`) for the degenerate
 * origin === destination case — use `isDegenerateArrival` rather than `.length === 1` to detect it.
 */
export function greatCircleLonLatPoints(
  origin: GlobeEffectAnchor,
  destination: GlobeEffectAnchor,
  segments: number,
): GlobeEffectAnchor[] {
  const basis = greatCircleBasis(origin, destination)
  if (basis.theta < DEGENERATE_ANGLE_RADIANS) return [origin]

  const points: GlobeEffectAnchor[] = []
  for (let i = 0; i <= segments; i++) {
    points.push(pointAtBasis(basis, i / segments))
  }
  return points
}

/** Fraction of the whole arc that `arrowheadPlacementAt` samples ahead for a tangent point —
 *  analytic rather than snapped to `ARC_SEGMENTS`, since the tip can sit at any `travelProgress`.
 *  A nearby point on the curve, not a bearing, so the renderer derives direction the same
 *  screen-space way the arc ribbon does (see `buildFatLineBuffers`'s `aDirA`/`aDirB`). */
const ARROWHEAD_TANGENT_FRACTION = 0.02

/** Where the migration arrowhead sits and points, at a given `travelProgress` (0 origin, 1 destination). */
export interface ArrowheadPlacement {
  /** The tip: head of the revealed arc while travelling, or the destination once travel completes. */
  anchor: GlobeEffectAnchor
  /** A point just behind the tip on the same great circle — not a bearing; the renderer derives a
   *  local tangent from the screen-space direction between the two, same as the arc ribbon's
   *  vertex shader (both go through the same `unfoldedLiftedPosition` twin, so this stays correct
   *  through the sphere/map unfold). */
  tail: GlobeEffectAnchor
}

/** `null` for a degenerate (point) arrival — no direction to show, so it stays a plain marker. */
export function arrowheadPlacementAt(effect: ArrivalGlobeEffect, travelProgress: number): ArrowheadPlacement | null {
  if (isDegenerateArrival(effect)) return null
  const basis = greatCircleBasis(effect.origin, effect.destination)
  const progress = clamp01(travelProgress)
  const anchor = pointAtBasis(basis, progress)
  const tail = pointAtBasis(basis, Math.max(0, progress - ARROWHEAD_TANGENT_FRACTION))
  return { anchor, tail }
}

/** Whether `effect` is the degenerate origin === destination case (ADR-032's Africa origin): a
 *  point marker, not a line. Checked on the curated anchors directly, not inferred from
 *  `greatCircleLonLatPoints`'s output length. */
export function isDegenerateArrival(effect: ArrivalGlobeEffect): boolean {
  return effect.origin.lat === effect.destination.lat && effect.origin.lon === effect.destination.lon
}

/** The one `windows` entry that reaches the present — the arc's visible span. `find` is safe
 *  because `pipeline.shapes.ArrivalEffect` and `curated.ts`'s parser both guarantee exactly one
 *  window with `tMin === 0` per arrival before it reaches this function. */
function persistentWindow(effect: ArrivalGlobeEffect): { tMin: GeoTime; tMax: GeoTime } {
  const found = effect.windows.find((w) => w.tMin === 0)
  if (found === undefined) {
    throw new Error(`arrival effect has no window with tMin === 0 — this should have been rejected at parse time`)
  }
  return found
}

// --------------------------------------------------------------------------- transient timing

/**
 * How long, in wall-clock seconds at the timeline's default playback rate, one arrival must stay
 * on screen in total (travel plus fade-out tail), and how long its tail alone must last.
 *
 * Nothing here reads a clock: `arrivalTimingFor` converts these seconds *once*, statically, into
 * widths in the timeline's warped space, and `arrivalPresentationAt` stays a pure function of `t`.
 * Sizing the tail in warp rather than years holds the guarantee at every era — playback moves at
 * constant velocity in warped space (`timeline/playback.ts`), so a constant warp width is a
 * constant number of seconds, whereas a fixed year count would flicker at 60 ka and linger at 700 BP.
 *
 * Near the present the remaining timeline can be narrower than `MIN_ARC_SECONDS` of warp, so a
 * recently-established arrival can't get its full tail — its fade runs out of timeline and it is
 * still partly drawn at `t = 0`. That's the honest floor, not a missing clamp.
 */
const MIN_ARC_SECONDS = 1.1
const MIN_TAIL_SECONDS = 0.4
/** Half-width of the landing ripple / inhabited-marker ease either side of `established`. */
const LANDING_SECONDS = 0.45
/** Width, past the landing above, over which the "inhabited" marker fades back out, so a
 *  `peopling` arrival reads as an event that happened and passed rather than a permanent mark.
 *  Unlike `MIN_ARC_SECONDS`'s tail, this is never allowed to run out of timeline: an arrival with
 *  less warp left than it needs has the whole settle-then-fade envelope squeezed to fit
 *  (`arrivalPresentationAt`), so every marker reaches 0 by `t = 0` — a recent arrival's marker
 *  comes and goes faster than an ancient one's rather than becoming a permanent dot. */
const INHABITED_FADE_SECONDS = 0.8

/** The arrival timing widths, in symlog-warp units — see `MIN_ARC_SECONDS`'s doc comment. */
export interface ArrivalTiming {
  minArcWarp: number
  minTailWarp: number
  landingWarp: number
  inhabitedFadeWarp: number
}

/** The full domain's warp span. `baseRate` is screen-space units per second across that span
 *  (`Playback.baseRate`), so `baseRate * FULL_DOMAIN_WARP` is warp per second. */
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
  /** 0 at the window's `tMax`, 1 at `established` and after. The travelling pulse's own position
   *  along the arc is a separate wall-clock loop (see `HumanCivilisation.tsx`) so it stays legible
   *  at any scrub speed. */
  travelProgress: number
  /** How far the arrival has settled at its destination: 0 at `established` and while still
   *  travelling, easing to 1 a `landingWarp` past it. */
  settleProgress: number
  /** The "inhabited" marker's weight at the destination, 0 .. 1: fades in as the arrival settles,
   *  then back out over `inhabitedFadeWarp` — it does not persist to the present. Always 0 for a
   *  `migration`; only first settlement leaves a marker (ADR-032 amendment). */
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
 * Squeezes an envelope of width `envelopeWarp` (warp units) to fit within `availableWarp` of warp
 * still to come before the present, preserving its proportions — 1 (no squeeze) when it already
 * fits, `availableWarp / envelopeWarp` otherwise. Shared by every settle/fade envelope below: a
 * recent arrival has little warp left between `established` and the present, and an un-squeezed
 * envelope would still be lit at `t = 0` — exactly the permanent mark these fades exist to remove.
 * Squeezing keeps the fade's shape and its purity in `t`, rather than a hard clamp truncating it.
 * Callers pass `establishedWarp` as `availableWarp` (the warp remaining between `established` and
 * the present).
 */
function squeezeToFit(envelopeWarp: number, availableWarp: number): number {
  return envelopeWarp > availableWarp && envelopeWarp > 0 ? availableWarp / envelopeWarp : 1
}

/**
 * The arrival's presentation at `t`: hidden above the window's `tMax`; drawn at full strength
 * while `t` runs from `tMax` down to `established`; then faded out across a tail wide enough that
 * the whole appearance lasts at least `MIN_ARC_SECONDS`. `established` is a hard dating fact —
 * travel ends and the tail begins there — but opacity either side of it is continuous, so the arc
 * never pops mid-flight.
 */
export function arrivalPresentationAt(effect: ArrivalGlobeEffect, t: GeoTime, timing: ArrivalTiming): ArrivalPresentation {
  const window = persistentWindow(effect)
  if (t > window.tMax) return HIDDEN_ARRIVAL

  const startWarp = symlogWarp(window.tMax)
  const establishedWarp = symlogWarp(effect.established)
  const currentWarp = symlogWarp(t)
  const travelWarp = Math.max(0, startWarp - establishedWarp)
  const tailWarp = Math.max(timing.minTailWarp, timing.minArcWarp - travelWarp)
  // Same squeeze as the settle/fade envelope below: a recently-established arrival may not have
  // `tailWarp` of warp left before the present, so fit the tail into what's actually left.
  const squeezedTailWarp = tailWarp * squeezeToFit(tailWarp, establishedWarp)

  const travelling = t >= effect.established
  const travelProgress = travelling && travelWarp > 0 ? clamp01((startWarp - currentWarp) / travelWarp) : 1
  const arcAlpha = travelling
    ? 1
    : clamp01(squeezedTailWarp > 0 ? (currentWarp - (establishedWarp - squeezedTailWarp)) / squeezedTailWarp : 0)

  const distancePastEstablished = establishedWarp - currentWarp
  const envelopeWarp = timing.landingWarp + timing.inhabitedFadeWarp
  const squeeze = squeezeToFit(envelopeWarp, establishedWarp)
  const landingWarp = timing.landingWarp * squeeze
  const fadeWarp = timing.inhabitedFadeWarp * squeeze

  const settleProgress = landingWarp > 0 ? easeSmoothstep(0, landingWarp, distancePastEstablished) : 1
  // Starts fading only once settleProgress has fully risen, so the marker never disappears before it has appeared.
  const inhabitedFadeOut =
    fadeWarp > 0 ? easeSmoothstep(landingWarp, landingWarp + fadeWarp, distancePastEstablished) : 1
  const inhabited = effect.arrivalKind === 'peopling' ? settleProgress * (1 - inhabitedFadeOut) : 0

  return { arcAlpha, travelling, travelProgress, settleProgress, inhabited }
}

/** Whether `t` is anywhere inside any arrival's visible span — the "Human civilisation" legend
 *  row reads this alongside the density and city equivalents. */
export function hasVisibleArrivals(events: readonly TimelineEvent[], t: GeoTime, timing: ArrivalTiming): boolean {
  for (const event of events) {
    if (event.effect === undefined || event.effect.kind !== 'arrival') continue
    const presentation = arrivalPresentationAt(event.effect, t, timing)
    if (presentation.arcAlpha > 0 || presentation.inhabited > 0) return true
  }
  return false
}

/** The arrival's visible window, `[established, tMax]` in `TimeWindow`'s `[newest, oldest]`
 *  ordering — what the tooltip prints via `@/timeline`'s `formatTimeRange`. */
export function arrivalWindow(effect: ArrivalGlobeEffect): readonly [GeoTime, GeoTime] {
  return [effect.established, persistentWindow(effect).tMax]
}

/** A lon/lat point carrying its cumulative progress (0 at `origin`, 1 at `destination`) along
 *  the *whole* pre-split arc, so a split piece's dash pattern
 *  (`HumanCivilisation.tsx`'s `ARC_FRAGMENT_SHADER`) picks up where the piece before it left off
 *  rather than restarting at 0 (docs/GLOBE.md §10). */
export interface DistancedAnchor extends GlobeEffectAnchor {
  distance: number
}

/** `splitAtAntimeridian`, interpolating `distance` through a synthesized seam point the same way
 *  as latitude — valid because `points` are evenly spaced in great-circle angle, so cumulative
 *  progress varies smoothly along the path (unlike lon/lat themselves near the seam). */
function splitArcAtAntimeridian(points: readonly DistancedAnchor[]): DistancedAnchor[][] {
  return splitAtAntimeridian(points, (prev, curr, f) => ({ distance: prev.distance + (curr.distance - prev.distance) * f }))
}

/** One arc's static (t-independent) geometry — built once and reused, never rebuilt per frame.
 *  `segments` splits at the antimeridian so a map-mode arc crossing it (Beringia to the Americas)
 *  draws as two pieces rather than streaking across the whole map width. */
export interface ArrivalArcGeometry {
  eventId: string
  effect: ArrivalGlobeEffect
  isDegenerate: boolean
  /** Empty for a degenerate (point-marker) arrival. Each inner array is one antimeridian-safe
   *  polyline segment; a non-crossing arc is a single segment. Each point's `distance` is
   *  cumulative across the *whole* arc, not reset per segment (docs/GLOBE.md §10) —
   *  `buildFatLineBuffers` passes it straight through to the dash pattern unchanged. */
  segments: DistancedAnchor[][]
}

const ARC_SEGMENTS = 48

export function buildArrivalArcGeometry(eventId: string, effect: ArrivalGlobeEffect): ArrivalArcGeometry {
  const isDegenerate = isDegenerateArrival(effect)
  if (isDegenerate) return { eventId, effect, isDegenerate, segments: [] }
  const points = greatCircleLonLatPoints(effect.origin, effect.destination, ARC_SEGMENTS)
  // Points are evenly spaced in angle, so point i's progress is exactly i / (points.length - 1) —
  // no arc-length computation needed. Guarded to 1 for the near-degenerate single-point edge case.
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
 * `gl.LINE_STRIP` (every mainstream WebGL backend clamps that to one device pixel regardless of
 * `gl.lineWidth`). Two vertices per point (`aSide = -1`/`+1`), expanded perpendicular to the
 * *screen-space* tangent in the vertex shader (`HumanCivilisation.tsx`'s `ARC_VERTEX_SHADER`) —
 * this function only supplies the per-point data the shader needs to compute that tangent, not
 * the tangent itself (it depends on the live camera).
 *
 * `aDirA`/`aDirB` are the point's own immediate neighbours (clamped at the arc's ends), and both
 * `aSide` copies of a point index share the same pair, so the ribbon's tangent at that index is
 * identical regardless of which of the two quads sharing it is drawn — avoiding a seam at the
 * joint between segments.
 *
 * `distance` is read from each point's own `DistancedAnchor.distance`, not recomputed as a
 * piece-local `i / (n - 1)` fraction — `points` here is one antimeridian split piece, and a
 * piece-local fraction would restart the dash pattern at 0 on every piece. Carrying a
 * cumulative, whole-arc distance through the split (`buildArrivalArcGeometry`/
 * `splitArcAtAntimeridian`) is what keeps a crossing arc's dash pattern continuous.
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
 * Smooth 0..1 visibility of a point on the sphere's surface (`direction`, a unit vector — pass
 * the marker's live *world*-space direction, already reflecting any auto-rotation, since it comes
 * from the marker's actual `Object3D.getWorldPosition`) as seen by a camera at `cameraPosition`,
 * `sphereRadius` units from the sphere's centre — same derivation as `poles.ts`'s `isPoleVisible`
 * (`dot(cameraPosition, direction) >= sphereRadius` at the true horizon), but returned as a
 * smoothstep fade across `MARKER_FADE_BAND` rather than a boolean. Combined with ordinary WebGL
 * depth-testing in the caller (`GlobeTooltip.tsx`), not a replacement for it — depth-testing alone
 * leaves a billboard quad ambiguous exactly at the limb, where near- and far-surface depth
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
