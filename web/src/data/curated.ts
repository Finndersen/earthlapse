/**
 * TS twin of pipeline/shapes.py sampling (DATA_SOURCES § Contract). Mirrors the Python
 * bisect-based sampling in pipeline/shapes.py exactly — same numbers, same edge cases.
 *
 * Owns the on-disk JSON shapes published by `earthtime publish` for scalar, raster and node
 * layers (LayerManifest.data in manifest.ts) and the pure samplers that read them.
 * EventSet data is inlined in Manifest.events (see manifest.ts) and has no equivalent here.
 */

import type { GeoTime, Interpolation, NodeValue, RasterValue, ScalarValue } from '@/types/layer'

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
}

// ------------------------------------------------------------------------------- parsing

const INTERPOLATIONS: ReadonlySet<string> = new Set(['linear', 'log-linear', 'step', 'nearest'])

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
  return { id, nodes }
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
