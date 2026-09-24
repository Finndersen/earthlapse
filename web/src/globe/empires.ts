/**
 * The historical-empires layer's pure core (ADR-059): which territorial snapshots are active at
 * `t`, which of them carry a label, and how a territory ring maps onto the equirectangular canvas
 * `empireTexture.ts` paints. No three.js and no canvas, so all of it is unit-tested in node.
 *
 * A snapshot is active for `tEnd < t <= tStart`. Snapshot boundaries cut the timeline into
 * segments inside which the active set cannot change, so the index precomputes one `EmpireFrame`
 * per segment and a lookup is a binary search. A frame's `key` names its active set; the globe
 * crossfades between frames (`usePresentedMix`) rather than morphing polygons, and uses the key
 * to cache the rasterised texture.
 */

import type { TerritoryData, TerritorySnapshotData } from '@/data/curated'
import type { MixKeying } from '@/lib/presentedMix'
import type { GeoTime } from '@/types/layer'

export interface EmpireSnapshot extends TerritorySnapshotData {
  colourSlot: number
}

/** One segment's active set. `order` is the segment's position along the timeline (oldest
 *  first), so two frames' distance reads as how far apart they are in `t`. */
export interface EmpireFrame {
  key: string
  order: number
  /** Sorted by lineage, then id. */
  snapshots: readonly EmpireSnapshot[]
}

export interface EmpireIndex {
  data: TerritoryData
  /** `[newest tEnd, oldest tStart]`: `t` lies inside when `tEnd < t <= tStart` for some snapshot
   *  boundary pair, so `empiresHaveDataAt` is `domain[0] < t <= domain[1]`. */
  domain: readonly [GeoTime, GeoTime]
  /** Every distinct `tStart`/`tEnd`, descending (oldest first). */
  boundaries: readonly GeoTime[]
  /** `frames[i]` holds for `boundaries[i + 1] < t <= boundaries[i]`. */
  frames: readonly EmpireFrame[]
  frameByKey: ReadonlyMap<string, EmpireFrame>
  /** The empty frames before the first and after the last boundary. */
  olderThanAll: EmpireFrame
  newerThanAll: EmpireFrame
}

function frameKey(snapshots: readonly EmpireSnapshot[]): string {
  return snapshots.map((s) => s.id).join(',')
}

export function buildEmpireIndex(data: TerritoryData): EmpireIndex {
  const slotByLineage = new Map(data.lineages.map((lineage) => [lineage.id, lineage.colourSlot]))
  const snapshots: EmpireSnapshot[] = data.snapshots.map((snapshot) => ({
    ...snapshot,
    colourSlot: slotByLineage.get(snapshot.lineage) ?? 0,
  }))
  const boundaries = [...new Set(snapshots.flatMap((s) => [s.tStart, s.tEnd]))].sort((a, b) => b - a)

  // Sweep oldest to newest: a snapshot enters at its tStart boundary and leaves at its tEnd one.
  const byStart = [...snapshots].sort((a, b) => b.tStart - a.tStart)
  const active = new Set<EmpireSnapshot>()
  const frames: EmpireFrame[] = []
  let next = 0
  for (let i = 0; i < boundaries.length - 1; i++) {
    const upper = boundaries[i]!
    for (const snapshot of active) if (snapshot.tEnd >= upper) active.delete(snapshot)
    while (next < byStart.length && byStart[next]!.tStart >= upper) {
      if (byStart[next]!.tEnd < upper) active.add(byStart[next]!)
      next++
    }
    const members = [...active].sort((a, b) => a.lineage.localeCompare(b.lineage) || a.id.localeCompare(b.id))
    frames.push({ key: frameKey(members), order: i, snapshots: members })
  }

  const frameByKey = new Map<string, EmpireFrame>()
  const olderThanAll: EmpireFrame = { key: '', order: -1, snapshots: [] }
  const newerThanAll: EmpireFrame = { key: '', order: frames.length, snapshots: [] }
  frameByKey.set('', olderThanAll)
  for (const frame of frames) if (!frameByKey.has(frame.key)) frameByKey.set(frame.key, frame)

  const domain: readonly [GeoTime, GeoTime] =
    boundaries.length === 0 ? [0, 0] : [boundaries[boundaries.length - 1]!, boundaries[0]!]
  return { data, domain, boundaries, frames, frameByKey, olderThanAll, newerThanAll }
}

/** The active set at `t` (half-open: a snapshot shows for `tEnd < t <= tStart`). */
export function empireSnapshotsAt(index: EmpireIndex, t: GeoTime): EmpireFrame {
  const { boundaries, frames } = index
  if (boundaries.length === 0 || t > boundaries[0]!) return index.olderThanAll
  if (t <= boundaries[boundaries.length - 1]!) return index.newerThanAll
  // Largest i with boundaries[i] >= t; boundaries are descending.
  let lo = 0
  let hi = boundaries.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (boundaries[mid]! >= t) lo = mid
    else hi = mid
  }
  return frames[lo]!
}

/** Whether `t` lies inside the layer's own time domain — the "Human civilisation" legend row's
 *  test for this part of the layer. */
export function empiresHaveDataAt(index: EmpireIndex | null, t: GeoTime): boolean {
  return index !== null && index.domain[0] < t && t <= index.domain[1]
}

export const EMPIRE_FRAME_KEYING: MixKeying<EmpireFrame> = {
  same: (a, b) => a.key === b.key,
  distance: (a, b) => Math.abs(a.order - b.order),
}

export interface EmpireLabel {
  lineage: string
  text: string
  lat: number
  lon: number
  colourSlot: number
  areaKm2: number
}

/**
 * One label per active lineage, placed on its largest active member snapshot, ranked by that
 * snapshot's area (largest first, id breaking ties) and capped. Deterministic in the frame, so
 * scrubbing back to the same `t` reproduces the same labels.
 */
export function empireLabelsAt(frame: EmpireFrame, cap: number): EmpireLabel[] {
  const largest = new Map<string, EmpireSnapshot>()
  for (const snapshot of frame.snapshots) {
    const kept = largest.get(snapshot.lineage)
    if (kept === undefined || snapshot.areaKm2 > kept.areaKm2 || (snapshot.areaKm2 === kept.areaKm2 && snapshot.id < kept.id)) {
      largest.set(snapshot.lineage, snapshot)
    }
  }
  return [...largest.values()]
    .sort((a, b) => b.areaKm2 - a.areaKm2 || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, cap))
    .map((s) => ({ lineage: s.lineage, text: s.label, lat: s.lat, lon: s.lon, colourSlot: s.colourSlot, areaKm2: s.areaKm2 }))
}

/** A label's half extents, in the same units as the positions `declutterLabelBoxes` compares. */
export interface LabelHalfExtents {
  halfWidth: number
  halfHeight: number
}

/**
 * Keeps labels in order, dropping each one whose box would overlap a box already kept. Boxes are
 * centred on each label's position in the globe's local space (y up): vertical overlap compares
 * y, horizontal overlap the chord distance in the x/z plane. That is exact on the map, which is a
 * plane facing the camera, and close on the sphere, which turns about its vertical axis.
 */
export function declutterLabelBoxes<T>(
  labels: readonly T[],
  positionOf: (label: T) => readonly [number, number, number],
  extentsOf: (label: T) => LabelHalfExtents,
): T[] {
  const kept: { position: readonly [number, number, number]; extents: LabelHalfExtents }[] = []
  const out: T[] = []
  for (const label of labels) {
    const position = positionOf(label)
    const extents = extentsOf(label)
    const overlaps = kept.some((other) => {
      const dy = Math.abs(position[1] - other.position[1])
      const dxz = Math.hypot(position[0] - other.position[0], position[2] - other.position[2])
      return dy < extents.halfHeight + other.extents.halfHeight && dxz < extents.halfWidth + other.extents.halfWidth
    })
    if (overlaps) continue
    kept.push({ position, extents })
    out.push(label)
  }
  return out
}

// ------------------------------------------------------------------------ canvas geometry

/** Cliopatria splits polygons at the antimeridian, leaving a straight edge along it. An edge whose
 *  endpoints both sit this close to ±180° is that cut, not a border, and is never stroked. */
export const ANTIMERIDIAN_EDGE_LON = 179.99

/** A flat `[lon, lat, ...]` ring as flat `[x, y, ...]` pixels on a `width`x`height` equirect
 *  canvas: `x = (lon + 180) / 360 * width`, `y = (90 - lat) / 180 * height` (row 0 is north). */
export function ringToPixels(ring: readonly number[], width: number, height: number): number[] {
  const out = new Array<number>(ring.length)
  for (let i = 0; i < ring.length; i += 2) {
    out[i] = ((ring[i]! + 180) / 360) * width
    out[i + 1] = ((90 - ring[i + 1]!) / 180) * height
  }
  return out
}

/** Twice the signed area of a flat pixel ring; positive is clockwise on screen (y points down). */
function signedArea2(xy: readonly number[]): number {
  let sum = 0
  const n = xy.length
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n
    sum += xy[i]! * xy[j + 1]! - xy[j]! * xy[i + 1]!
  }
  return sum
}

/**
 * The ring in pixels, wound clockwise on screen for an exterior and anticlockwise for a hole.
 * Filling every ring of a lineage in one path with the nonzero rule then unions overlapping
 * members (no doubled alpha) while still cutting holes, whatever winding the source used.
 */
export function orientedRingPixels(ring: readonly number[], width: number, height: number, exterior: boolean): number[] {
  const xy = ringToPixels(ring, width, height)
  const clockwise = signedArea2(xy) > 0
  if (clockwise === exterior) return xy
  const reversed = new Array<number>(xy.length)
  for (let i = 0; i < xy.length; i += 2) {
    reversed[xy.length - 2 - i] = xy[i]!
    reversed[xy.length - 1 - i] = xy[i + 1]!
  }
  return reversed
}

export interface RingStroke {
  /** Flat `[x, y, ...]` polylines to stroke. */
  runs: number[][]
  /** Whether the single run is the whole ring (stroke it closed). */
  closed: boolean
}

function onAntimeridian(lon: number): boolean {
  return Math.abs(lon) >= ANTIMERIDIAN_EDGE_LON
}

/**
 * The ring's outline in pixels as polylines, leaving out every edge that runs along the
 * antimeridian cut (`ANTIMERIDIAN_EDGE_LON`). A ring with no such edge is one closed run.
 */
export function ringStrokeRuns(ring: readonly number[], width: number, height: number): RingStroke {
  const xy = ringToPixels(ring, width, height)
  const n = ring.length / 2
  const skip = new Array<boolean>(n)
  let firstSkip = -1
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    skip[i] = onAntimeridian(ring[2 * i]!) && onAntimeridian(ring[2 * j]!)
    if (skip[i] && firstSkip < 0) firstSkip = i
  }
  if (firstSkip < 0) return { runs: [xy], closed: true }

  const runs: number[][] = []
  let run: number[] = []
  // Start just after a skipped edge so no run wraps round the ring's seam.
  for (let step = 1; step <= n; step++) {
    const edge = (firstSkip + step) % n
    if (skip[edge]) {
      if (run.length >= 4) runs.push(run)
      run = []
      continue
    }
    const j = (edge + 1) % n
    if (run.length === 0) run.push(xy[2 * edge]!, xy[2 * edge + 1]!)
    run.push(xy[2 * j]!, xy[2 * j + 1]!)
  }
  if (run.length >= 4) runs.push(run)
  return { runs, closed: false }
}
