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

import type { TerritoryData, TerritoryGeometry, TerritoryLineageData, TerritoryPolygon, TerritorySnapshotData } from '@/data/curated'
import type { MixKeying } from '@/lib/presentedMix'
import { formatCalendarYear, formatGeoTime } from '@/timeline'
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

/** One member state's run within its lineage: active for `tEnd < t <= tStart`, from its oldest
 *  snapshot's start to its newest snapshot's end. */
export interface EmpireMemberSpan {
  member: number
  label: string
  wikipedia: string | null
  tStart: GeoTime
  tEnd: GeoTime
}

/** The lineage's summed active-member area over `tEnd < t <= tStart`. */
export interface EmpireAreaStep {
  tStart: GeoTime
  tEnd: GeoTime
  areaKm2: number
}

/** Everything the detail panel and tooltip show about one lineage, derived once from the data. */
export interface EmpireLineageSummary {
  lineage: TerritoryLineageData
  /** Members with at least one snapshot, oldest first. */
  members: readonly EmpireMemberSpan[]
  /** Oldest first, contiguous between the lineage's first and last boundary; a gap is a 0 step. */
  area: readonly EmpireAreaStep[]
  /** The largest step (the oldest on a tie). */
  peak: EmpireAreaStep
  /** `[newest tEnd, oldest tStart]`. */
  span: readonly [GeoTime, GeoTime]
}

export interface EmpireIndex {
  data: TerritoryData
  lineages: ReadonlyMap<string, EmpireLineageSummary>
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
  const lineages = new Map<string, EmpireLineageSummary>()
  for (const lineage of data.lineages) {
    const summary = summariseLineage(lineage, snapshots.filter((s) => s.lineage === lineage.id))
    if (summary !== null) lineages.set(lineage.id, summary)
  }
  return { data, lineages, domain, boundaries, frames, frameByKey, olderThanAll, newerThanAll }
}

/** `null` for a lineage with no snapshots. */
function summariseLineage(lineage: TerritoryLineageData, snapshots: readonly TerritorySnapshotData[]): EmpireLineageSummary | null {
  if (snapshots.length === 0) return null
  const spans = new Map<number, EmpireMemberSpan>()
  for (const s of snapshots) {
    const span = spans.get(s.member)
    if (span === undefined) {
      const { label, wikipedia } = lineage.members[s.member]!
      spans.set(s.member, { member: s.member, label, wikipedia, tStart: s.tStart, tEnd: s.tEnd })
    } else {
      span.tStart = Math.max(span.tStart, s.tStart)
      span.tEnd = Math.min(span.tEnd, s.tEnd)
    }
  }
  const members = [...spans.values()].sort((a, b) => b.tStart - a.tStart || a.member - b.member)

  const boundaries = [...new Set(snapshots.flatMap((s) => [s.tStart, s.tEnd]))].sort((a, b) => b - a)
  const area: EmpireAreaStep[] = []
  for (let i = 0; i < boundaries.length - 1; i++) {
    const tStart = boundaries[i]!
    const tEnd = boundaries[i + 1]!
    let areaKm2 = 0
    for (const s of snapshots) if (s.tStart >= tStart && s.tEnd <= tEnd) areaKm2 += s.areaKm2
    area.push({ tStart, tEnd, areaKm2 })
  }
  let peak = area[0]!
  for (const step of area) if (step.areaKm2 > peak.areaKm2) peak = step
  return { lineage, members, area, peak, span: [boundaries[boundaries.length - 1]!, boundaries[0]!] }
}

/** The lineage's summed active area at `t`, 0 outside its span or in a gap. */
export function lineageAreaAt(summary: EmpireLineageSummary, t: GeoTime): number {
  for (const step of summary.area) if (step.tEnd < t && t <= step.tStart) return step.areaKm2
  return 0
}

/** The member span active at `t`, or `null`. */
export function memberAt(summary: EmpireLineageSummary, t: GeoTime): EmpireMemberSpan | null {
  let found: EmpireMemberSpan | null = null
  // Newest-starting wins where two members overlap (a successor alongside its predecessor's tail).
  for (const span of summary.members) if (span.tEnd < t && t <= span.tStart) found = span
  return found
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

/** `lineage` when the frame draws any of its members, else `null`: a highlight the frame cannot
 *  show paints (and caches) as no highlight at all. */
export function empireHighlightIn(frame: EmpireFrame, lineage: string | null): string | null {
  return lineage !== null && frame.snapshots.some((s) => s.lineage === lineage) ? lineage : null
}

export const EMPIRE_FRAME_KEYING: MixKeying<EmpireFrame> = {
  same: (a, b) => a.key === b.key,
  distance: (a, b) => Math.abs(a.order - b.order),
}

export interface EmpireLabel {
  snapshot: EmpireSnapshot
  lineage: string
  text: string
  lat: number
  lon: number
  colourSlot: number
  areaKm2: number
}

/**
 * One label per active lineage, placed on its largest active member snapshot, ranked by that
 * snapshot's area (largest first, id breaking ties). Deterministic in the frame, so scrubbing back
 * to the same `t` reproduces the same labels.
 */
export function empireLabelsAt(frame: EmpireFrame): EmpireLabel[] {
  const largest = new Map<string, EmpireSnapshot>()
  for (const snapshot of frame.snapshots) {
    const kept = largest.get(snapshot.lineage)
    if (kept === undefined || snapshot.areaKm2 > kept.areaKm2 || (snapshot.areaKm2 === kept.areaKm2 && snapshot.id < kept.id)) {
      largest.set(snapshot.lineage, snapshot)
    }
  }
  return [...largest.values()]
    .sort((a, b) => b.areaKm2 - a.areaKm2 || a.id.localeCompare(b.id))
    .map((s) => ({ snapshot: s, lineage: s.lineage, text: s.label, lat: s.lat, lon: s.lon, colourSlot: s.colourSlot, areaKm2: s.areaKm2 }))
}

/** A label's half extents, in the same units as the positions `declutterLabelBoxes` compares. */
export interface LabelHalfExtents {
  halfWidth: number
  halfHeight: number
}

/** A kept label and the row it sits in: 0 on its anchor, -1 one box height above, 1 below. */
export interface PlacedLabelBox<T> {
  label: T
  row: number
}

/**
 * Keeps labels in order, placing each in the first of `rows` where its box overlaps no box already
 * kept, and dropping it only when every row collides. Boxes are centred on each label's screen
 * position (y down), shifted one full box height per row.
 */
export function declutterLabelBoxes<T>(
  labels: readonly T[],
  positionOf: (label: T) => readonly [number, number],
  extentsOf: (label: T) => LabelHalfExtents,
  rows: readonly number[] = [0],
): PlacedLabelBox<T>[] {
  const kept: { x: number; y: number; extents: LabelHalfExtents }[] = []
  const out: PlacedLabelBox<T>[] = []
  for (const label of labels) {
    const [x, y0] = positionOf(label)
    const extents = extentsOf(label)
    for (const row of rows) {
      const y = y0 + row * 2 * extents.halfHeight
      const overlaps = kept.some(
        (other) =>
          Math.abs(y - other.y) < extents.halfHeight + other.extents.halfHeight &&
          Math.abs(x - other.x) < extents.halfWidth + other.extents.halfWidth,
      )
      if (overlaps) continue
      kept.push({ x, y, extents })
      out.push({ label, row })
      break
    }
  }
  return out
}

/**
 * The labels drawn for `ranked` (from `empireLabelsAt`): only those `screenOf` places on screen
 * (`null` when off screen or round the back of the sphere), highlighted lineages first so a hovered
 * or selected empire always keeps its name, then by area, each in the first of `rows` where its box
 * overlaps none already placed (`declutterLabelBoxes`, in CSS px). Only on-screen
 * labels compete for room, so zooming in, which spreads them apart, names more of them.
 */
export function placeEmpireLabels(
  ranked: readonly EmpireLabel[],
  highlight: ReadonlySet<string>,
  screenOf: (label: EmpireLabel) => readonly [number, number] | null,
  extentsOf: (label: EmpireLabel) => LabelHalfExtents,
  rows: readonly number[],
): PlacedLabelBox<EmpireLabel>[] {
  const onScreen: { label: EmpireLabel; x: number; y: number }[] = []
  for (const emphasised of [true, false]) {
    for (const label of ranked) {
      if (highlight.has(label.lineage) !== emphasised) continue
      const point = screenOf(label)
      if (point !== null) onScreen.push({ label, x: point[0], y: point[1] })
    }
  }
  return declutterLabelBoxes(
    onScreen,
    ({ x, y }) => [x, y],
    ({ label }) => extentsOf(label),
    rows,
  ).map(({ label, row }) => ({ label: label.label, row }))
}

// ------------------------------------------------------------------------------- hit test

type Bounds = readonly [number, number, number, number]

const polygonBounds = new WeakMap<TerritoryPolygon, Bounds>()

/** `[lonMin, latMin, lonMax, latMax]` of a polygon's exterior, cached per polygon. */
function boundsOf(polygon: TerritoryPolygon): Bounds {
  let bounds = polygonBounds.get(polygon)
  if (bounds === undefined) {
    const ring = polygon[0]!
    let lonMin = Infinity
    let latMin = Infinity
    let lonMax = -Infinity
    let latMax = -Infinity
    for (let i = 0; i < ring.length; i += 2) {
      lonMin = Math.min(lonMin, ring[i]!)
      lonMax = Math.max(lonMax, ring[i]!)
      latMin = Math.min(latMin, ring[i + 1]!)
      latMax = Math.max(latMax, ring[i + 1]!)
    }
    bounds = [lonMin, latMin, lonMax, latMax]
    polygonBounds.set(polygon, bounds)
  }
  return bounds
}

/** Even-odd crossing test of one flat `[lon, lat, ...]` ring. */
function ringContains(ring: readonly number[], lon: number, lat: number): boolean {
  let inside = false
  const n = ring.length
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i]!
    const yi = ring[i + 1]!
    const xj = ring[j]!
    const yj = ring[j + 1]!
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/**
 * Whether `(lon, lat)` lies inside any of the polygons: inside an exterior and outside its holes.
 * For valid polygons that is what the painter's nonzero fill over oriented rings covers.
 */
export function territoryContains(polygons: readonly TerritoryPolygon[], lon: number, lat: number): boolean {
  for (const polygon of polygons) {
    const [lonMin, latMin, lonMax, latMax] = boundsOf(polygon)
    if (lon < lonMin || lon > lonMax || lat < latMin || lat > latMax) continue
    if (!ringContains(polygon[0]!, lon, lat)) continue
    let inHole = false
    for (let r = 1; r < polygon.length && !inHole; r++) inHole = ringContains(polygon[r]!, lon, lat)
    if (!inHole) return true
  }
  return false
}

/** The frame's snapshot whose territory contains `(lon, lat)` — the smallest, where members
 *  overlap — or `null`. */
export function empireAtLonLat(frame: EmpireFrame, geometry: TerritoryGeometry, lon: number, lat: number): EmpireSnapshot | null {
  let best: EmpireSnapshot | null = null
  for (const snapshot of frame.snapshots) {
    if (best !== null && snapshot.areaKm2 >= best.areaKm2) continue
    const polygons = geometry.snapshots.get(snapshot.id)
    if (polygons !== undefined && territoryContains(polygons, lon, lat)) best = snapshot
  }
  return best
}

// ------------------------------------------------------------------------ canvas geometry

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

// ------------------------------------------------------------------------------- wording

/** An area for the tooltip and panel: `4.4M km²` from a million up, `350k km²` below. */
export function formatEmpireArea(areaKm2: number): string {
  if (areaKm2 >= 1e6) return `${(areaKm2 / 1e6).toFixed(1)}M km²`
  return `${Math.max(1, Math.round(areaKm2 / 1e3)).toLocaleString('en-US')}k km²`
}

/** The tooltip's area line: the lineage's area at `t` against its peak, or the peak alone while
 *  `t` is inside the peak step. */
export function empireAreaLine(summary: EmpireLineageSummary, t: GeoTime): string {
  const { peak } = summary
  if (peak.tEnd < t && t <= peak.tStart) return `${summary.lineage.name} · at its peak, ${formatEmpireArea(peak.areaKm2)}`
  return (
    `${summary.lineage.name} · about ${formatEmpireArea(lineageAreaAt(summary, t))} now ` +
    `(peak ${formatEmpireArea(peak.areaKm2)} in ${formatEmpireYear(peak.tStart)})`
  )
}

/** `t` as a calendar year where one reads naturally, else as elapsed time. */
export function formatEmpireYear(t: GeoTime): string {
  return formatCalendarYear(t) ?? formatGeoTime(t)
}

/** A `tEnd < t <= tStart` span as its first and last calendar years (`tEnd` itself is the first
 *  year after it). */
export function formatEmpireSpan(tStart: GeoTime, tEnd: GeoTime): string {
  return `${formatEmpireYear(tStart)} – ${formatEmpireYear(tEnd + 1)}`
}
