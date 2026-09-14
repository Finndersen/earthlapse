/**
 * TS twin of pipeline/shapes.py sampling (DATA_SOURCES § Contract). Mirrors the Python
 * bisect-based sampling in pipeline/shapes.py exactly — same numbers, same edge cases.
 *
 * Owns the on-disk JSON shapes published by `earthtime publish` for scalar, raster, node and
 * (docs/GLOBE.md §6) non-timeline events layers (LayerManifest.data in manifest.ts) and the
 * pure samplers that read them. `events-core`, the timeline's own `EventSet`, is inlined in
 * `Manifest.events` instead (see manifest.ts) and has no `EventsData` file of its own — but
 * `parseTimelineEvent` here is exactly what parses each of those entries too, since
 * `manifest.ts` already depends on this module.
 */

import type {
  EventKind,
  EventsValue,
  EventTag,
  GeoTime,
  GlobeEffect,
  Interpolation,
  NodeValue,
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

export interface SeriesData {
  id: string
  unit: string
  interpolation: Interpolation
  samples: SeriesSample[]
}

export interface RasterFrameData {
  t: GeoTime
  ref: string
}

export interface RasterData {
  id: string
  frames: RasterFrameData[]
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

/** Mirrors `PortraitPlateData` in pipeline/manifest.py. */
export interface PortraitPlateData {
  nodeId: string
  image: string
  plate: PortraitPlateType
  pinned: string
  width: number
  height: number
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
const GLOBE_EFFECT_KINDS: ReadonlySet<string> = new Set([
  'impact-winter',
  'giant-impact',
  'flood-basalt',
  'ice-shell',
  'regime-magma-ocean',
  'regime-water-world',
  'regime-archean',
  'regime-unknown-geography',
])

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

/** Validates and sorts ascending by `t`, mirroring `TimeSeries._sorted` in shapes.py. */
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
  return { id, unit, interpolation: interpolationRaw as Interpolation, samples }
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
  return { id, frames }
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

/** Validates the additive `effect` block on a `TimelineEvent` (docs/GLOBE.md §6). Returns
 *  `undefined` when the field is absent, mirroring every other optional field here. */
function parseGlobeEffect(v: unknown, path: string): GlobeEffect | undefined {
  if (v === undefined || v === null) return undefined
  const root = expectRecord(v, path)
  const kind = expectString(root.kind, `${path}.kind`)
  if (!GLOBE_EFFECT_KINDS.has(kind)) {
    throw new Error(`${path}.kind: unknown GlobeEffectKind "${kind}"`)
  }
  const rawWindows = expectArray(root.windows, `${path}.windows`)
  if (rawWindows.length === 0) {
    throw new Error(`${path}: empty windows`)
  }
  const windows = rawWindows.map((raw, i) => {
    const w = expectRecord(raw, `${path}.windows[${i}]`)
    return {
      tMin: expectNumber(w.tMin, `${path}.windows[${i}].tMin`),
      tMax: expectNumber(w.tMax, `${path}.windows[${i}].tMax`),
    }
  })
  const effect: GlobeEffect = { kind: kind as GlobeEffect['kind'], windows }
  if (root.anchor !== undefined && root.anchor !== null) {
    const a = expectRecord(root.anchor, `${path}.anchor`)
    effect.anchor = { lat: expectNumber(a.lat, `${path}.anchor.lat`), lon: expectNumber(a.lon, `${path}.anchor.lon`) }
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

/** Validates one `TimelineEvent` — shared by `manifest.ts` (each entry of `Manifest.events`)
 *  and `parseEventsData` below (each entry of a non-timeline `EventsData` layer file), since
 *  both are the same wire shape (`pipeline.manifest.TimelineEvent`). `kind`/`t`/`tags`
 *  (ADR-022) are parsed leniently — present-and-valid or absent, never required — because the
 *  currently-published manifest and the committed stub both predate this field; rendering the
 *  timeline by them is a later task. */
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

function expectPositiveNumber(v: unknown, path: string): number {
  const n = expectNumber(v, path)
  if (!(n > 0)) throw new Error(`${path}: expected a positive number, got ${n}`)
  return n
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
    return {
      nodeId,
      image: expectString(p.image, `${path}.plates[${i}].image`),
      plate: plate as PortraitPlateType,
      pinned: expectString(p.pinned, `${path}.plates[${i}].pinned`),
      width: expectPositiveNumber(p.width, `${path}.plates[${i}].width`),
      height: expectPositiveNumber(p.height, `${path}.plates[${i}].height`),
    }
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
 * Mirrors `TimeSeries.sample`: null outside the domain, the exact sample verbatim on an
 * exact match, otherwise blended by `data.interpolation`. Bounds are a TS-only extension —
 * carried when both bracketing samples (or the exact match itself) have lower/upper.
 */
export function sampleSeries(data: SeriesData, t: GeoTime): ScalarValue | null {
  const { samples } = data
  const lo = samples[0]!.t
  const hi = samples[samples.length - 1]!.t
  if (t < lo || t > hi) return null

  const ts = samples.map((s) => s.t)
  const i = bisectLeft(ts, t)

  if (i < samples.length && ts[i] === t) {
    const s = samples[i]!
    const result: ScalarValue = { kind: 'scalar', value: s.value, unit: data.unit }
    if (s.lower !== null && s.upper !== null) {
      result.bounds = [s.lower, s.upper]
    }
    return result
  }

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
 * one or several (docs/GLOBE.md's regimes deliberately overlap at their soft boundaries).
 * Not domain-gated the way `sampleSeries`/`sampleRaster` are: `EventsData` has no declared
 * sample range of its own, only its events' own intervals — an empty match is not "no data",
 * it is "nothing active right now", so this never returns null.
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
