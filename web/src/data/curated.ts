/**
 * TS twin of pipeline/shapes.py sampling (DATA_SOURCES § Contract) — same bisect logic, same
 * numbers, same edge cases.
 *
 * Owns the on-disk JSON shapes published by `earthlapse publish` for scalar, raster, node and
 * (docs/GLOBE.md §6) non-timeline events layers (LayerManifest.data in manifest.ts) and the
 * pure samplers that read them. `events-core` has no `EventsData` file of its own — it's
 * inlined in `Manifest.events` (manifest.ts), parsed by `parseTimelineEvent` below.
 */

import type {
  ArrivalKind,
  EventKind,
  EventsValue,
  EventTag,
  FeatureCertainty,
  FeatureData,
  GeoTime,
  GlobeEffect,
  Interpolation,
  NodeValue,
  PointGlobeEffect,
  PopulationEstimateData,
  PortraitPlateType,
  RasterValue,
  ScalarValue,
  TimelineEvent,
} from '@/types/layer'

// ------------------------------------------------------------------------------- shapes

export interface SeriesSample {
  t: GeoTime
  value: number
  lower: number | null
  upper: number | null
}

/**
 * An open interval with no data, spanning exactly one pair of adjacent samples in a
 * `SeriesData` (post-sort). Mirrors `pipeline.shapes.Gap` (ADR-027): adjacency
 * (`toIndex === fromIndex + 1`) is checked once, by `parseSeriesData`, not re-derived from
 * ages by every reader.
 */
export interface SeriesGap {
  fromIndex: number
  toIndex: number
}

export interface SeriesData {
  id: string
  unit: string
  interpolation: Interpolation
  samples: SeriesSample[]
  /** Additive (ADR-027): ordered, non-overlapping. Absent or empty means no gap — the series
   *  from before this field existed and every series with none stay indistinguishable. */
  gaps?: SeriesGap[]
}

export interface RasterFrameData {
  t: GeoTime
  ref: string
}

/** Which single byte channel of a raster's texture carries the quantity. Mirrors
 *  `pipeline.manifest.RasterEncoding.channel`. */
export type RasterChannel = 'r' | 'g' | 'b'

/**
 * How a `RasterData`'s texture bytes decode to a real physical quantity (ADR-031 amendment).
 * Additive: absent for a colour-only raster (`paleodem`, the two `basemap` tiers,
 * `plates_neoproterozoic`) and on every layer file published before this field existed. Mirrors
 * `pipeline.manifest.RasterEncoding`; `decodeLogDensity` below is the TS twin of
 * `pipeline.density_encoding.decode_log_density` and must produce the same numbers from the same
 * published `dMax`.
 */
export interface RasterEncoding {
  channel: RasterChannel
  unit: string
  /** The value that encodes to the top of the 8-bit range. Strictly positive. */
  dMax: number
}

export interface RasterData {
  id: string
  frames: RasterFrameData[]
  /** Additive (ADR-031 amendment): absent on a colour-only raster. */
  encoding?: RasterEncoding
}

/**
 * Inverse of `pipeline.density_encoding.encode_log_density`. `unit` is the texel's byte
 * divided by 255 (0..1), `dMax` the published ceiling. Takes the normalised sample rather than
 * the raw byte because that's what both callers hold — a GLSL `texture2D` read and a canvas
 * `ImageData` byte already divided down — so the formula stays identical on both sides.
 */
export function decodeLogDensity(unit: number, dMax: number): number {
  if (!(dMax > 0)) throw new Error(`decodeLogDensity: dMax must be > 0, got ${dMax}`)
  const logMax = Math.log10(1 + dMax)
  return Math.pow(10, Math.min(1, Math.max(0, unit)) * logMax) - 1
}

export interface TreeNodeData {
  id: string
  parent: string | null
  label: string
  tDivergence: GeoTime
  representative: string | null
  note: string | null
  citation: string | null
}

export interface TreeData {
  id: string
  nodes: TreeNodeData[]
  /** Additive (ADR-015): published ancestor portraits. Absent when none are published. */
  portraits?: PortraitSetData
}

/**
 * A non-timeline `EventSet`, published as its own layer file (docs/GLOBE.md §6) — e.g.
 * `globe-regimes`, which `Manifest.events` never lists (that field is `events-core` only).
 * Mirrors `pipeline.manifest.EventsData`.
 */
export interface EventsData {
  id: string
  events: TimelineEvent[]
}

/**
 * A `FeatureSet` published as its own layer file (ADR-035) — e.g. `cities`. Mirrors
 * `pipeline.manifest.FeatureSetData`.
 */
export interface FeatureSetData {
  id: string
  features: FeatureData[]
}

/** Mirrors `PortraitExposureData` in pipeline/manifest.py: how publish normalised a plate's
 *  exposure. `highlight` is the pinned original's subject highlight (a luma code, null when no
 *  subject stands out); `gain` the linear-light gain applied, 1 when `image` is the pinned file. */
export interface PortraitExposureData {
  highlight: number | null
  gain: number
}

/** Mirrors `PortraitPlateData` in pipeline/manifest.py. */
export interface PortraitPlateData {
  nodeId: string
  image: string
  plate: PortraitPlateType
  pinned: string
  width: number
  height: number
  /** Additive (ADR-015 amendment), absent from layer files published before it. Provenance
   *  only: `image` is already exposure-normalised, so the viewer draws it as is. */
  exposure?: PortraitExposureData
}

/** Mirrors `PortraitMorphData` in pipeline/manifest.py. */
export interface PortraitMorphData {
  older: string
  younger: string
  forward: string
  backward: string
  forwardRange: number
  backwardRange: number
  size: number
}

export interface PortraitSetData {
  /** Ascending by the portrayed node's `tDivergence`, like the nodes themselves. */
  plates: PortraitPlateData[]
  morphs: PortraitMorphData[]
}

// ------------------------------------------------------------------------------- parsing

const INTERPOLATIONS: ReadonlySet<string> = new Set(['linear', 'log-linear', 'step', 'nearest'])
const PLATE_TYPES: ReadonlySet<string> = new Set(['SPECIMEN', 'MICROSCOPE'])
const EVENT_KINDS: ReadonlySet<string> = new Set(['moment', 'period'])
const EVENT_TAGS: ReadonlySet<string> = new Set([
  'life',
  'earth-climate',
  'catastrophe',
  'human-origins',
  'society',
  'science-technology',
])
const POINT_GLOBE_EFFECT_KINDS: ReadonlySet<string> = new Set([
  'impact-winter',
  'giant-impact',
  'flood-basalt',
  'ice-shell',
  'regime-magma-ocean',
  'regime-water-world',
  'regime-archean',
  'regime-unknown-geography',
])
const ARRIVAL_GLOBE_EFFECT_KIND = 'arrival'
const ARRIVAL_KINDS: ReadonlySet<string> = new Set(['peopling', 'migration'])
const GLOBE_EFFECT_KINDS: ReadonlySet<string> = new Set([...POINT_GLOBE_EFFECT_KINDS, ARRIVAL_GLOBE_EFFECT_KIND])

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function expectString(v: unknown, path: string): string {
  if (typeof v !== 'string') {
    throw new Error(`${path}: expected a string, got ${v === null ? 'null' : typeof v}`)
  }
  return v
}

function expectNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new Error(`${path}: expected a number, got ${v === null ? 'null' : typeof v}`)
  }
  return v
}

function expectNullableNumber(v: unknown, path: string): number | null {
  if (v === null || v === undefined) return null
  return expectNumber(v, path)
}

function expectNullableString(v: unknown, path: string): string | null {
  if (v === null || v === undefined) return null
  return expectString(v, path)
}

function expectArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) {
    throw new Error(`${path}: expected an array, got ${v === null ? 'null' : typeof v}`)
  }
  return v
}

function expectRecord(v: unknown, path: string): Record<string, unknown> {
  if (!isRecord(v)) {
    throw new Error(`${path}: expected an object, got ${v === null ? 'null' : typeof v}`)
  }
  return v
}

function parseSeriesGap(v: unknown, path: string): SeriesGap {
  const g = expectRecord(v, path)
  return {
    fromIndex: expectNumber(g.fromIndex, `${path}.fromIndex`),
    toIndex: expectNumber(g.toIndex, `${path}.toIndex`),
  }
}

/**
 * Sorts ascending by `fromIndex` (mirroring `TimeSeries._gaps_valid` in shapes.py) and checks
 * every invariant it does: each gap spans exactly one pair of adjacent sample indices, in
 * range, and gaps do not overlap (though two may touch at one shared boundary sample).
 */
function validateGaps(gaps: SeriesGap[], sampleCount: number, id: string): void {
  gaps.sort((a, b) => a.fromIndex - b.fromIndex)
  let previousToIndex = -1
  for (const gap of gaps) {
    if (gap.toIndex !== gap.fromIndex + 1) {
      throw new Error(`${id}: gap (${gap.fromIndex}, ${gap.toIndex}) is not adjacent`)
    }
    if (gap.toIndex >= sampleCount) {
      throw new Error(`${id}: gap toIndex ${gap.toIndex} out of range for ${sampleCount} samples`)
    }
    if (gap.fromIndex < previousToIndex) {
      throw new Error(`${id}: gaps overlap at sample index ${gap.fromIndex}`)
    }
    previousToIndex = gap.toIndex
  }
}

/**
 * Validates and sorts ascending by `t`, mirroring `TimeSeries._sorted` in shapes.py — then, if
 * `gaps` is present, validates it the way `TimeSeries._gaps_valid` does (ADR-027).
 */
export function parseSeriesData(json: unknown): SeriesData {
  const root = expectRecord(json, 'SeriesData')
  const id = expectString(root.id, 'SeriesData.id')
  const unit = expectString(root.unit, 'SeriesData.unit')
  const interpolationRaw = expectString(root.interpolation, 'SeriesData.interpolation')
  if (!INTERPOLATIONS.has(interpolationRaw)) {
    throw new Error(`${id}: unknown interpolation "${interpolationRaw}"`)
  }
  const rawSamples = expectArray(root.samples, `${id}.samples`)
  if (rawSamples.length === 0) {
    throw new Error(`${id}: empty SeriesData`)
  }
  const samples: SeriesSample[] = rawSamples.map((raw, i) => {
    const s = expectRecord(raw, `${id}.samples[${i}]`)
    return {
      t: expectNumber(s.t, `${id}.samples[${i}].t`),
      value: expectNumber(s.value, `${id}.samples[${i}].value`),
      lower: expectNullableNumber(s.lower, `${id}.samples[${i}].lower`),
      upper: expectNullableNumber(s.upper, `${id}.samples[${i}].upper`),
    }
  })
  samples.sort((a, b) => a.t - b.t)
  const data: SeriesData = { id, unit, interpolation: interpolationRaw as Interpolation, samples }
  if (root.gaps !== undefined && root.gaps !== null) {
    const gaps = expectArray(root.gaps, `${id}.gaps`).map((raw, i) =>
      parseSeriesGap(raw, `${id}.gaps[${i}]`),
    )
    validateGaps(gaps, samples.length, id)
    data.gaps = gaps
  }
  return data
}

const RASTER_CHANNELS: ReadonlySet<string> = new Set(['r', 'g', 'b'])

/** Validates the additive `encoding` block (ADR-031 amendment), mirroring
 *  `pipeline.manifest.RasterEncoding`'s own field constraints. */
function parseRasterEncoding(v: unknown, path: string): RasterEncoding {
  const r = expectRecord(v, path)
  const channel = expectString(r.channel, `${path}.channel`)
  if (!RASTER_CHANNELS.has(channel)) {
    throw new Error(`${path}.channel: unknown RasterChannel "${channel}"`)
  }
  return {
    channel: channel as RasterChannel,
    unit: expectString(r.unit, `${path}.unit`),
    dMax: expectPositiveNumber(r.dMax, `${path}.dMax`),
  }
}

/** Validates and sorts ascending by `t`, mirroring `RasterSequence._sorted` in shapes.py. */
export function parseRasterData(json: unknown): RasterData {
  const root = expectRecord(json, 'RasterData')
  const id = expectString(root.id, 'RasterData.id')
  const rawFrames = expectArray(root.frames, `${id}.frames`)
  if (rawFrames.length === 0) {
    throw new Error(`${id}: empty RasterData`)
  }
  const frames: RasterFrameData[] = rawFrames.map((raw, i) => {
    const f = expectRecord(raw, `${id}.frames[${i}]`)
    return {
      t: expectNumber(f.t, `${id}.frames[${i}].t`),
      ref: expectString(f.ref, `${id}.frames[${i}].ref`),
    }
  })
  frames.sort((a, b) => a.t - b.t)
  const data: RasterData = { id, frames }
  if (root.encoding !== undefined && root.encoding !== null) {
    data.encoding = parseRasterEncoding(root.encoding, `${id}.encoding`)
  }
  return data
}

/**
 * Validates and sorts ascending by `tDivergence`, mirroring `Tree._sorted` in shapes.py —
 * including the unknown-parent check, run after every node id is known.
 */
export function parseTreeData(json: unknown): TreeData {
  const root = expectRecord(json, 'TreeData')
  const id = expectString(root.id, 'TreeData.id')
  const rawNodes = expectArray(root.nodes, `${id}.nodes`)
  if (rawNodes.length === 0) {
    throw new Error(`${id}: empty TreeData`)
  }
  const nodes: TreeNodeData[] = rawNodes.map((raw, i) => {
    const n = expectRecord(raw, `${id}.nodes[${i}]`)
    return {
      id: expectString(n.id, `${id}.nodes[${i}].id`),
      parent: expectNullableString(n.parent, `${id}.nodes[${i}].parent`),
      label: expectString(n.label, `${id}.nodes[${i}].label`),
      tDivergence: expectNumber(n.tDivergence, `${id}.nodes[${i}].tDivergence`),
      representative: expectNullableString(n.representative, `${id}.nodes[${i}].representative`),
      note: expectNullableString(n.note, `${id}.nodes[${i}].note`),
      citation: expectNullableString(n.citation, `${id}.nodes[${i}].citation`),
    }
  })
  nodes.sort((a, b) => a.tDivergence - b.tDivergence)
  const ids = new Set(nodes.map((n) => n.id))
  for (const n of nodes) {
    if (n.parent !== null && !ids.has(n.parent)) {
      throw new Error(`${id}: node ${n.id} has unknown parent ${n.parent}`)
    }
  }
  const tree: TreeData = { id, nodes }
  if (root.portraits !== undefined && root.portraits !== null) {
    tree.portraits = parsePortraitSet(root.portraits, id, nodes)
  }
  return tree
}

function parseGlobeEffectAnchor(v: unknown, path: string): { lat: number; lon: number } {
  const a = expectRecord(v, path)
  return { lat: expectNumber(a.lat, `${path}.lat`), lon: expectNumber(a.lon, `${path}.lon`) }
}

function parseGlobeEffectWindows(v: unknown, path: string): { tMin: GeoTime; tMax: GeoTime }[] {
  const rawWindows = expectArray(v, path)
  if (rawWindows.length === 0) {
    throw new Error(`${path}: empty windows`)
  }
  return rawWindows.map((raw, i) => {
    const w = expectRecord(raw, `${path}[${i}]`)
    return {
      tMin: expectNumber(w.tMin, `${path}[${i}].tMin`),
      tMax: expectNumber(w.tMax, `${path}[${i}].tMax`),
    }
  })
}

/** Validates the additive `effect` block on a `TimelineEvent` (docs/GLOBE.md §6, ADR-032).
 *  `undefined` when absent, like every other optional field here. Dispatches on `kind`:
 *  `'arrival'` parses as `ArrivalGlobeEffect` (required origin/destination), every other kind
 *  as `PointGlobeEffect` — mirrors `pipeline.shapes.AnyGlobeEffect`'s discriminated union, so a
 *  malformed `arrival` block fails loudly here too, not just in the pipeline. */
function parseGlobeEffect(v: unknown, path: string): GlobeEffect | undefined {
  if (v === undefined || v === null) return undefined
  const root = expectRecord(v, path)
  const kind = expectString(root.kind, `${path}.kind`)
  if (!GLOBE_EFFECT_KINDS.has(kind)) {
    throw new Error(`${path}.kind: unknown GlobeEffectKind "${kind}"`)
  }
  const windows = parseGlobeEffectWindows(root.windows, `${path}.windows`)

  if (kind === ARRIVAL_GLOBE_EFFECT_KIND) {
    // Mirrors pipeline.shapes.ArrivalEffect: exactly one window may reach the present
    // (tMin === 0) — a second would be ambiguous about which one arcs.ts's persistentWindow uses.
    const presentWindows = windows.filter((w) => w.tMin === 0)
    if (presentWindows.length !== 1) {
      throw new Error(
        `${path}: arrival effect must have exactly one window with tMin === 0 (present), found ${presentWindows.length}`,
      )
    }
    const established = expectNumber(root.established, `${path}.established`)
    if (!windows.some((w) => w.tMin <= established && established <= w.tMax)) {
      throw new Error(`${path}.established: ${established} falls outside every window`)
    }
    // Required, never defaulted (ADR-032 amendment): decides whether the destination keeps a
    // persistent "inhabited" marker, so a default would silently mis-render an omitted one.
    const arrivalKind = expectString(root.arrivalKind, `${path}.arrivalKind`)
    if (!ARRIVAL_KINDS.has(arrivalKind)) {
      throw new Error(`${path}.arrivalKind: unknown ArrivalKind "${arrivalKind}"`)
    }
    return {
      kind: 'arrival',
      arrivalKind: arrivalKind as ArrivalKind,
      origin: parseGlobeEffectAnchor(root.origin, `${path}.origin`),
      destination: parseGlobeEffectAnchor(root.destination, `${path}.destination`),
      established,
      windows,
    }
  }

  const effect: PointGlobeEffect = { kind: kind as PointGlobeEffect['kind'], windows }
  if (root.anchor !== undefined && root.anchor !== null) {
    effect.anchor = parseGlobeEffectAnchor(root.anchor, `${path}.anchor`)
  }
  return effect
}

/** Validates the additive, optional `kind` field (ADR-022) — absent on any event published
 *  before it existed. Returns `undefined` for that case, mirroring `parseGlobeEffect`. */
function parseEventKind(v: unknown, path: string): EventKind | undefined {
  if (v === undefined || v === null) return undefined
  const s = expectString(v, path)
  if (!EVENT_KINDS.has(s)) {
    throw new Error(`${path}: unknown EventKind "${s}"`)
  }
  return s as EventKind
}

/** Validates the additive, optional `tags` field (ADR-022), same absent-is-fine rule as
 *  `parseEventKind`. Every present tag must be in the closed set. */
function parseEventTags(v: unknown, path: string): EventTag[] | undefined {
  if (v === undefined || v === null) return undefined
  return expectArray(v, path).map((raw, i) => {
    const s = expectString(raw, `${path}[${i}]`)
    if (!EVENT_TAGS.has(s)) {
      throw new Error(`${path}[${i}]: unknown EventTag "${s}"`)
    }
    return s as EventTag
  })
}

/** Validates one `TimelineEvent` — shared by `manifest.ts` (`Manifest.events`) and
 *  `parseEventsData` below, since both are the same wire shape (`pipeline.manifest.
 *  TimelineEvent`). `kind`/`t`/`tags` (ADR-022) are parsed leniently — present-and-valid or
 *  absent, never required — since some published manifests predate this field. */
export function parseTimelineEvent(v: unknown, path: string): TimelineEvent {
  const r = expectRecord(v, path)
  const event: TimelineEvent = {
    id: expectString(r.id, `${path}.id`),
    label: expectString(r.label, `${path}.label`),
    tMin: expectNumber(r.tMin, `${path}.tMin`),
    tMax: expectNumber(r.tMax, `${path}.tMax`),
    importance: expectNumber(r.importance, `${path}.importance`),
    description: expectString(r.description, `${path}.description`),
    citation: expectString(r.citation, `${path}.citation`),
  }
  const kind = parseEventKind(r.kind, `${path}.kind`)
  if (kind !== undefined) event.kind = kind
  if (r.t !== undefined && r.t !== null) {
    event.t = expectNumber(r.t, `${path}.t`)
  }
  const tags = parseEventTags(r.tags, `${path}.tags`)
  if (tags !== undefined) event.tags = tags
  const effect = parseGlobeEffect(r.effect, `${path}.effect`)
  if (effect !== undefined) event.effect = effect
  return event
}

/** Validates a non-timeline `EventsData` layer file (docs/GLOBE.md §6), e.g. `globe-regimes`. */
export function parseEventsData(json: unknown): EventsData {
  const root = expectRecord(json, 'EventsData')
  const id = expectString(root.id, 'EventsData.id')
  const rawEvents = expectArray(root.events, `${id}.events`)
  if (rawEvents.length === 0) {
    throw new Error(`${id}: empty EventsData`)
  }
  const events = rawEvents.map((raw, i) => parseTimelineEvent(raw, `${id}.events[${i}]`))
  return { id, events }
}

const FEATURE_CERTAINTIES: ReadonlySet<string> = new Set(['high', 'medium', 'low'])

function parseFeatureCertainty(v: unknown, path: string): FeatureCertainty {
  const s = expectString(v, path)
  if (!FEATURE_CERTAINTIES.has(s)) {
    throw new Error(`${path}: unknown FeatureCertainty "${s}"`)
  }
  return s as FeatureCertainty
}

/** Mirrors `pipeline.shapes.PopulationEstimate` (ADR-035). */
function parsePopulationEstimate(v: unknown, path: string): PopulationEstimateData {
  const r = expectRecord(v, path)
  return {
    t: expectNumber(r.t, `${path}.t`),
    population: expectPositiveNumber(r.population, `${path}.population`),
  }
}

/**
 * Validates one `FeatureData` (ADR-035), mirroring `pipeline.shapes.Feature`: lat/lon range
 * checks, a non-empty estimates list, and estimates sorted ascending by `t` with no duplicate
 * `t` (`Feature._estimates_sorted_and_unique`) — sorted here too, not just checked, so an
 * already-sorted producer round-trips unchanged and an unsorted one doesn't ship silently.
 */
function parseFeatureData(v: unknown, path: string): FeatureData {
  const r = expectRecord(v, path)
  const id = expectString(r.id, `${path}.id`)
  const lat = expectNumber(r.lat, `${path}.lat`)
  if (!(lat >= -90 && lat <= 90)) throw new Error(`${path}.lat: out of range, got ${lat}`)
  const lon = expectNumber(r.lon, `${path}.lon`)
  if (!(lon >= -180 && lon <= 180)) throw new Error(`${path}.lon: out of range, got ${lon}`)
  const rawEstimates = expectArray(r.estimates, `${path}.estimates`)
  if (rawEstimates.length === 0) {
    throw new Error(`${id}: empty estimates`)
  }
  const estimates = rawEstimates.map((raw, i) =>
    parsePopulationEstimate(raw, `${path}.estimates[${i}]`),
  )
  estimates.sort((a, b) => a.t - b.t)
  const seenT = new Set<number>()
  for (const estimate of estimates) {
    if (seenT.has(estimate.t)) throw new Error(`${id}: duplicate estimate t ${estimate.t}`)
    seenT.add(estimate.t)
  }
  return {
    id,
    name: expectString(r.name, `${path}.name`),
    country: expectString(r.country, `${path}.country`),
    lat,
    lon,
    certainty: parseFeatureCertainty(r.certainty, `${path}.certainty`),
    estimates,
  }
}

/**
 * Validates a `FeatureSet` layer file (ADR-035), e.g. `cities` — sorts features by `id` and
 * rejects a duplicate id, mirroring `pipeline.shapes.FeatureSet._sorted_and_unique`.
 */
export function parseFeatureSetData(json: unknown): FeatureSetData {
  const root = expectRecord(json, 'FeatureSetData')
  const id = expectString(root.id, 'FeatureSetData.id')
  const rawFeatures = expectArray(root.features, `${id}.features`)
  if (rawFeatures.length === 0) {
    throw new Error(`${id}: empty FeatureSetData`)
  }
  const features = rawFeatures.map((raw, i) => parseFeatureData(raw, `${id}.features[${i}]`))
  features.sort((a, b) => a.id.localeCompare(b.id))
  const seenIds = new Set<string>()
  for (const feature of features) {
    if (seenIds.has(feature.id)) throw new Error(`${id}: duplicate feature id ${feature.id}`)
    seenIds.add(feature.id)
  }
  return { id, features }
}

function expectPositiveNumber(v: unknown, path: string): number {
  const n = expectNumber(v, path)
  if (!(n > 0)) throw new Error(`${path}: expected a positive number, got ${n}`)
  return n
}

function parsePortraitExposure(json: unknown, path: string): PortraitExposureData {
  const e = expectRecord(json, path)
  const gain = expectNumber(e.gain, `${path}.gain`)
  if (!(gain >= 1)) throw new Error(`${path}.gain: exposure never darkens a plate, got ${gain}`)
  return { highlight: expectNullableNumber(e.highlight, `${path}.highlight`), gain }
}

/**
 * Validates the additive portrait block (ADR-015): every plate names a node of this tree once,
 * plates sort ascending by that node's `tDivergence`, and every morph joins a plate to the
 * next older plate — the only pair the viewer ever warps between.
 */
function parsePortraitSet(json: unknown, treeId: string, nodes: readonly TreeNodeData[]): PortraitSetData {
  const path = `${treeId}.portraits`
  const root = expectRecord(json, path)
  const divergence = new Map(nodes.map((n) => [n.id, n.tDivergence]))
  const rawPlates = expectArray(root.plates, `${path}.plates`)
  if (rawPlates.length === 0) throw new Error(`${path}: empty plates`)
  const plates: PortraitPlateData[] = rawPlates.map((raw, i) => {
    const p = expectRecord(raw, `${path}.plates[${i}]`)
    const nodeId = expectString(p.nodeId, `${path}.plates[${i}].nodeId`)
    if (!divergence.has(nodeId)) throw new Error(`${path}.plates[${i}]: unknown node ${nodeId}`)
    const plate = expectString(p.plate, `${path}.plates[${i}].plate`)
    if (!PLATE_TYPES.has(plate)) throw new Error(`${path}.plates[${i}]: unknown plate type "${plate}"`)
    const parsed: PortraitPlateData = {
      nodeId,
      image: expectString(p.image, `${path}.plates[${i}].image`),
      plate: plate as PortraitPlateType,
      pinned: expectString(p.pinned, `${path}.plates[${i}].pinned`),
      width: expectPositiveNumber(p.width, `${path}.plates[${i}].width`),
      height: expectPositiveNumber(p.height, `${path}.plates[${i}].height`),
    }
    if (p.exposure !== undefined) parsed.exposure = parsePortraitExposure(p.exposure, `${path}.plates[${i}].exposure`)
    return parsed
  })
  if (new Set(plates.map((p) => p.nodeId)).size !== plates.length) {
    throw new Error(`${path}: a node has more than one plate`)
  }
  plates.sort((a, b) => divergence.get(a.nodeId)! - divergence.get(b.nodeId)!)
  const order = plates.map((p) => p.nodeId)

  const morphs: PortraitMorphData[] = expectArray(root.morphs, `${path}.morphs`).map((raw, i) => {
    const m = expectRecord(raw, `${path}.morphs[${i}]`)
    const morph: PortraitMorphData = {
      older: expectString(m.older, `${path}.morphs[${i}].older`),
      younger: expectString(m.younger, `${path}.morphs[${i}].younger`),
      forward: expectString(m.forward, `${path}.morphs[${i}].forward`),
      backward: expectString(m.backward, `${path}.morphs[${i}].backward`),
      forwardRange: expectPositiveNumber(m.forwardRange, `${path}.morphs[${i}].forwardRange`),
      backwardRange: expectPositiveNumber(m.backwardRange, `${path}.morphs[${i}].backwardRange`),
      size: expectPositiveNumber(m.size, `${path}.morphs[${i}].size`),
    }
    const youngerIndex = order.indexOf(morph.younger)
    if (youngerIndex < 0 || order[youngerIndex + 1] !== morph.older) {
      throw new Error(`${path}.morphs[${i}]: ${morph.older} -> ${morph.younger} joins no adjacent plates`)
    }
    return morph
  })
  return { plates, morphs }
}

// ------------------------------------------------------------------------------ sampling

/** `bisect.bisect_left` over an ascending array: first index whose value is >= t. */
function bisectLeft(sorted: readonly number[], t: GeoTime): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (sorted[mid]! < t) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

/** Mirrors `_blend` in shapes.py exactly, including log-linear's non-positive degradation. */
function blend(a: number, b: number, f: number, how: Interpolation): number {
  switch (how) {
    case 'linear':
      return a + (b - a) * f
    case 'log-linear':
      if (a <= 0 || b <= 0) return a + (b - a) * f
      return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * f)
    case 'step':
      return a
    case 'nearest':
      return f < 0.5 ? a : b
  }
}

/**
 * Per-series `t` array and gap lookup, built once and reused across every `sampleSeries` call
 * against the same `data` — rebuilding it with `.map` per call gets expensive at real row
 * counts (co2: 1,977). Keyed by object identity in a `WeakMap`, not a mutable field on `data`:
 * `sampleSeries(data, t)` stays a pure function of `t`, this is just a cache of derived work.
 */
interface SeriesIndex {
  ts: number[]
  gapFromIndices: ReadonlySet<number>
}

const seriesIndexCache = new WeakMap<SeriesData, SeriesIndex>()

function indexOf(data: SeriesData): SeriesIndex {
  let index = seriesIndexCache.get(data)
  if (index === undefined) {
    index = {
      ts: data.samples.map((s) => s.t),
      gapFromIndices: new Set((data.gaps ?? []).map((g) => g.fromIndex)),
    }
    seriesIndexCache.set(data, index)
  }
  return index
}

/**
 * Mirrors `TimeSeries.sample`: null outside the domain, the exact sample verbatim on an exact
 * match, null strictly inside a declared gap (ADR-027), otherwise blended by
 * `data.interpolation`. Bounds are a TS-only extension, carried when both bracketing samples
 * (or the exact match) have lower/upper.
 */
export function sampleSeries(data: SeriesData, t: GeoTime): ScalarValue | null {
  const { samples } = data
  const lo = samples[0]!.t
  const hi = samples[samples.length - 1]!.t
  if (t < lo || t > hi) return null

  const { ts, gapFromIndices } = indexOf(data)
  const i = bisectLeft(ts, t)

  if (i < samples.length && ts[i] === t) {
    const s = samples[i]!
    const result: ScalarValue = { kind: 'scalar', value: s.value, unit: data.unit }
    if (s.lower !== null && s.upper !== null) {
      result.bounds = [s.lower, s.upper]
    }
    return result
  }

  if (gapFromIndices.has(i - 1)) return null

  const a = samples[i - 1]!
  const b = samples[i]!
  const f = (t - a.t) / (b.t - a.t)
  const result: ScalarValue = {
    kind: 'scalar',
    value: blend(a.value, b.value, f, data.interpolation),
    unit: data.unit,
  }
  if (a.lower !== null && a.upper !== null && b.lower !== null && b.upper !== null) {
    result.bounds = [
      blend(a.lower, b.lower, f, data.interpolation),
      blend(a.upper, b.upper, f, data.interpolation),
    ]
  }
  return result
}

/** Mirrors `RasterSequence.sample`: exact match collapses before/after with alpha 0. */
export function sampleRaster(data: RasterData, t: GeoTime): RasterValue | null {
  const { frames } = data
  const lo = frames[0]!.t
  const hi = frames[frames.length - 1]!.t
  if (t < lo || t > hi) return null

  const ts = frames.map((f) => f.t)
  const i = bisectLeft(ts, t)

  if (i < frames.length && ts[i] === t) {
    const ref = frames[i]!.ref
    return { kind: 'raster', before: ref, after: ref, alpha: 0 }
  }

  const a = frames[i - 1]!
  const b = frames[i]!
  return { kind: 'raster', before: a.ref, after: b.ref, alpha: (t - a.t) / (b.t - a.t) }
}

/**
 * Mirrors `EventSet.sample`: every event whose `[tMin, tMax]` interval contains `t` — zero,
 * one, or several (docs/GLOBE.md's regimes deliberately overlap at their soft boundaries).
 * Unlike `sampleSeries`/`sampleRaster`, `EventsData` has no domain of its own; an empty match
 * means "nothing active", not "no data", so this never returns null.
 */
export function sampleEvents(data: EventsData, t: GeoTime): EventsValue {
  return { kind: 'events', events: data.events.filter((e) => t >= e.tMin && t <= e.tMax) }
}

/**
 * Mirrors `Tree.sample`: the youngest node with `tDivergence >= t` (bisect_left), i.e. the
 * ancestor alive at t. Null before the root (no node old enough to have already diverged).
 */
export function sampleTree(data: TreeData, t: GeoTime): NodeValue | null {
  const ts = data.nodes.map((n) => n.tDivergence)
  const i = bisectLeft(ts, t)
  if (i >= data.nodes.length) return null
  const n = data.nodes[i]!
  const result: NodeValue = { kind: 'node', id: n.id, label: n.label, tDivergence: n.tDivergence }
  if (n.representative !== null) {
    result.representative = n.representative
  }
  return result
}

/** Mirrors `Tree.path_to`: walks parent links back to the root, root first. */
export function pathToRoot(data: TreeData, nodeId: string): TreeNodeData[] {
  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  const out: TreeNodeData[] = []
  let cur = byId.get(nodeId) ?? null
  while (cur !== null) {
    out.push(cur)
    cur = cur.parent !== null ? (byId.get(cur.parent) ?? null) : null
  }
  return out.reverse()
}
