/**
 * Loads and validates the published manifest (web/src/types/manifest.ts, NORMATIVE).
 *
 * `loadManifest()` fetches `/media/manifest.json` — where `earthlapse publish` writes real
 * output — and falls back to the committed `/stub/manifest.json` only on a 404, flagging the
 * fallback so the shell can show a "stub data" badge instead of pretending it's real. Any
 * other failure (network error, non-404 status, malformed JSON, a schema mismatch) throws:
 * the page must show a loud error panel, never render half of a broken manifest.
 *
 * Validation is hand-written rather than a schema library — the manifest is small, the shape
 * is pinned in manifest.ts, and matching curated.ts's existing style keeps one validation
 * idiom across the frontend instead of introducing a second one for this one file.
 */

import type {
  AudioLoop,
  AudioStem,
  Chapter,
  Credit,
  LayerDataKind,
  LayerManifest,
  Manifest,
  Scene,
  SceneCoordinates,
  SceneFraming,
  SceneLocation,
  SceneSound,
  SoundMode,
} from '@/types/manifest'
import { MAX_PORTRAIT_ZOOM } from '@/types/manifest'
import type { Interpolation, LayerSurface } from '@/types/layer'
import {
  parseEventsData,
  parseFeatureSetData,
  parseRasterData,
  parseSeriesData,
  parseTerritoryData,
  parseTimelineEvent,
  parseTreeData,
  type EventsData,
  type FeatureSetData,
  type RasterData,
  type SeriesData,
  type TerritoryData,
  type TreeData,
} from '@/data/curated'

/**
 * Where published media lives. Defaults to the dev server's own `/media` symlink; a deployment
 * sets `NEXT_PUBLIC_MEDIA_BASE` to the R2 origin (Next inlines it at build time) so the export
 * carries no media of its own.
 */
const MEDIA_BASE = process.env.NEXT_PUBLIC_MEDIA_BASE ?? '/media'

/** The committed fallback, served from the site's own origin whatever `MEDIA_BASE` points at. */
const STUB_BASE = '/stub'

const MANIFEST_FILE = 'manifest.json'
const MANIFEST_URL = `${MEDIA_BASE}/${MANIFEST_FILE}`
const STUB_MANIFEST_URL = `${STUB_BASE}/${MANIFEST_FILE}`

export interface ManifestLoadResult {
  manifest: Manifest
  /** True when `/media/manifest.json` was absent and `/stub/manifest.json` was used instead. */
  isStub: boolean
}

/**
 * Fetches the published manifest, falling back to the stub on a 404. Throws on anything else
 * going wrong — a caller that wants a loud error panel should let this propagate uncaught.
 *
 * `assetBase` is overwritten with the base the manifest was actually found at, whatever the
 * publish step wrote into the file. Media and the manifest are always published together, so the
 * one is always reachable from the other's origin; taking the published string at face value
 * instead made two independent settings — `earthlapse publish --asset-base` and
 * `NEXT_PUBLIC_MEDIA_BASE` — that had to be kept in agreement by hand, and a manifest published
 * for the deployed origin then pointed a local dev server's every asset fetch at the CDN.
 */
export async function loadManifest(): Promise<ManifestLoadResult> {
  const primary = await fetchManifest(MANIFEST_URL)
  if (primary !== null) {
    return { manifest: { ...validateManifest(primary), assetBase: MEDIA_BASE }, isStub: false }
  }
  const stub = await fetchManifest(STUB_MANIFEST_URL)
  if (stub === null) {
    throw new Error(`${STUB_MANIFEST_URL}: not found — no manifest available`)
  }
  return { manifest: { ...validateManifest(stub), assetBase: STUB_BASE }, isStub: true }
}

/** Fetches and JSON-parses a manifest URL. Returns null on a 404; throws on any other
 *  non-OK response so a real failure (500, network error) is never mistaken for "try the
 *  stub". */
async function fetchManifest(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`${url}: fetch failed with status ${res.status}`)
  }
  return res.json()
}

// ------------------------------------------------------------------------------- validation

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function expectRecord(v: unknown, path: string): Record<string, unknown> {
  if (!isRecord(v)) {
    throw new Error(`${path}: expected an object, got ${v === null ? 'null' : typeof v}`)
  }
  return v
}

function expectString(v: unknown, path: string): string {
  if (typeof v !== 'string') {
    throw new Error(`${path}: expected a string, got ${v === null ? 'null' : typeof v}`)
  }
  return v
}

function expectOptionalString(v: unknown, path: string): string | undefined {
  if (v === undefined) return undefined
  return expectString(v, path)
}

function expectNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || Number.isNaN(v)) {
    throw new Error(`${path}: expected a number, got ${v === null ? 'null' : typeof v}`)
  }
  return v
}

function expectBoolean(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') {
    throw new Error(`${path}: expected a boolean, got ${v === null ? 'null' : typeof v}`)
  }
  return v
}

function expectArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) {
    throw new Error(`${path}: expected an array, got ${v === null ? 'null' : typeof v}`)
  }
  return v
}

function expectOneOf<T extends string>(v: unknown, options: readonly T[], path: string): T {
  const s = expectString(v, path)
  if (!(options as readonly string[]).includes(s)) {
    throw new Error(`${path}: expected one of ${options.join(', ')}, got "${s}"`)
  }
  return s as T
}

function expectTuple2(v: unknown, path: string): [number, number] {
  const arr = expectArray(v, path)
  if (arr.length !== 2) {
    throw new Error(`${path}: expected a 2-element tuple, got ${arr.length} elements`)
  }
  return [expectNumber(arr[0], `${path}[0]`), expectNumber(arr[1], `${path}[1]`)]
}

const SHOT_TYPES = ['WIDE_RIDGE', 'WATER_EDGE', 'CANOPY', 'GROUND', 'SPLIT_LEVEL'] as const
const LAYER_SURFACES: readonly LayerSurface[] = ['globe', 'timeline-lane', 'hud', 'scene-overlay']
const LAYER_DATA_KINDS: readonly LayerDataKind[] = ['scalar', 'events', 'raster', 'node', 'features', 'territories']
const INTERPOLATIONS: readonly Interpolation[] = ['linear', 'log-linear', 'step', 'nearest']
const SOUND_MODES: readonly SoundMode[] = ['loop', 'once']

function validateSceneSound(v: unknown, path: string): SceneSound {
  const r = expectRecord(v, path)
  return {
    stem: expectString(r.stem, `${path}.stem`),
    mode: expectOneOf(r.mode, SOUND_MODES, `${path}.mode`),
    gain: expectNumber(r.gain, `${path}.gain`),
  }
}

function validateSceneCoordinates(v: unknown, path: string): SceneCoordinates {
  const r = expectRecord(v, path)
  const lat = expectNumber(r.lat, `${path}.lat`)
  if (!(lat >= -90 && lat <= 90)) throw new Error(`${path}.lat: out of range, got ${lat}`)
  const lon = expectNumber(r.lon, `${path}.lon`)
  if (!(lon >= -180 && lon <= 180)) throw new Error(`${path}.lon: out of range, got ${lon}`)
  return { lat, lon }
}

/** ADR-034. `marker` is explicitly nullable on the wire (publish writes `null` when no plate
 *  model covers the scene's age) — kept as a real `null` rather than collapsed to `undefined`,
 *  so "this scene has a place but we cannot put it on the globe" stays distinguishable from
 *  "this scene has no place at all" (an absent `location`). */
function validateSceneLocation(v: unknown, path: string): SceneLocation {
  const r = expectRecord(v, path)
  return {
    label: expectString(r.label, `${path}.label`),
    presentDay: validateSceneCoordinates(r.presentDay, `${path}.presentDay`),
    marker: r.marker === null || r.marker === undefined ? null : validateSceneCoordinates(r.marker, `${path}.marker`),
  }
}

function validateSceneFraming(v: unknown, path: string): SceneFraming {
  const r = expectRecord(v, path)
  const focus = expectTuple2(r.focus, `${path}.focus`)
  for (const [i, f] of focus.entries()) {
    if (!(f >= 0 && f <= 1)) throw new Error(`${path}.focus[${i}]: out of range, got ${f}`)
  }
  const pan = expectNumber(r.pan, `${path}.pan`)
  if (!(pan >= 0 && pan < 360)) throw new Error(`${path}.pan: out of range, got ${pan}`)
  const framing: SceneFraming = { focus, pan }
  if (r.portraitZoom !== undefined) {
    const portraitZoom = expectNumber(r.portraitZoom, `${path}.portraitZoom`)
    if (!(portraitZoom >= 1 && portraitZoom <= MAX_PORTRAIT_ZOOM)) {
      throw new Error(`${path}.portraitZoom: out of range, got ${portraitZoom}`)
    }
    framing.portraitZoom = portraitZoom
  }
  return framing
}

function validateScene(v: unknown, path: string): Scene {
  const r = expectRecord(v, path)
  const scene: Scene = {
    id: expectString(r.id, `${path}.id`),
    t: expectNumber(r.t, `${path}.t`),
    chapterId: expectString(r.chapterId, `${path}.chapterId`),
    image: expectString(r.image, `${path}.image`),
    thumbnail: expectString(r.thumbnail, `${path}.thumbnail`),
    shot: expectOneOf(r.shot, SHOT_TYPES, `${path}.shot`),
    title: expectString(r.title, `${path}.title`),
    caption: expectString(r.caption, `${path}.caption`),
    width: expectNumber(r.width, `${path}.width`),
    height: expectNumber(r.height, `${path}.height`),
  }
  const depth = expectOptionalString(r.depth, `${path}.depth`)
  if (depth !== undefined) scene.depth = depth
  if (r.events !== undefined) {
    scene.events = expectArray(r.events, `${path}.events`).map((e, i) =>
      expectString(e, `${path}.events[${i}]`),
    )
  }
  if (r.sound !== undefined) {
    scene.sound = validateSceneSound(r.sound, `${path}.sound`)
  }
  if (r.location !== undefined && r.location !== null) {
    scene.location = validateSceneLocation(r.location, `${path}.location`)
  }
  if (r.framing !== undefined && r.framing !== null) {
    scene.framing = validateSceneFraming(r.framing, `${path}.framing`)
  }
  const pinned = expectOptionalString(r.pinned, `${path}.pinned`)
  if (pinned !== undefined) scene.pinned = pinned
  return scene
}

function validateChapter(v: unknown, path: string): Chapter {
  const r = expectRecord(v, path)
  const chapter: Chapter = {
    id: expectString(r.id, `${path}.id`),
    label: expectString(r.label, `${path}.label`),
    tStart: expectNumber(r.tStart, `${path}.tStart`),
    tEnd: expectNumber(r.tEnd, `${path}.tEnd`),
  }
  const anchorImage = expectOptionalString(r.anchorImage, `${path}.anchorImage`)
  if (anchorImage !== undefined) chapter.anchorImage = anchorImage
  return chapter
}

function validateLayerManifest(v: unknown, path: string): LayerManifest {
  const r = expectRecord(v, path)
  const layer: LayerManifest = {
    id: expectString(r.id, `${path}.id`),
    name: expectString(r.name, `${path}.name`),
    surface: expectOneOf(r.surface, LAYER_SURFACES, `${path}.surface`),
    dataKind: expectOneOf(r.dataKind, LAYER_DATA_KINDS, `${path}.dataKind`),
    timeDomain: expectTuple2(r.timeDomain, `${path}.timeDomain`),
    source: expectString(r.source, `${path}.source`),
    chartable: expectBoolean(r.chartable, `${path}.chartable`),
    data: expectString(r.data, `${path}.data`),
  }
  const unit = expectOptionalString(r.unit, `${path}.unit`)
  if (unit !== undefined) layer.unit = unit
  if (r.interpolation !== undefined) {
    layer.interpolation = expectOneOf(r.interpolation, INTERPOLATIONS, `${path}.interpolation`)
  }
  return layer
}

function validateAudioStem(v: unknown, path: string): AudioStem {
  const r = expectRecord(v, path)
  const stem: AudioStem = {
    id: expectString(r.id, `${path}.id`),
    file: expectString(r.file, `${path}.file`),
    title: expectString(r.title, `${path}.title`),
    author: expectString(r.author, `${path}.author`),
    licence: expectString(r.licence, `${path}.licence`),
    sourceUrl: expectString(r.sourceUrl, `${path}.sourceUrl`),
    durationSeconds: expectNumber(r.durationSeconds, `${path}.durationSeconds`),
    loopSafe: expectBoolean(r.loopSafe, `${path}.loopSafe`),
    levelTrimDb: expectNumber(r.levelTrimDb, `${path}.levelTrimDb`),
  }
  if (r.loop !== undefined) stem.loop = validateAudioLoop(r.loop, `${path}.loop`)
  if (r.startSeconds !== undefined) {
    stem.startSeconds = expectNumber(r.startSeconds, `${path}.startSeconds`)
  }
  return stem
}

function validateAudioLoop(v: unknown, path: string): AudioLoop {
  const r = expectRecord(v, path)
  const loop = {
    startSeconds: expectNumber(r.startSeconds, `${path}.startSeconds`),
    endSeconds: expectNumber(r.endSeconds, `${path}.endSeconds`),
  }
  if (!(loop.startSeconds >= 0 && loop.startSeconds < loop.endSeconds)) {
    throw new Error(`${path}: expected 0 <= startSeconds < endSeconds, got ${loop.startSeconds}..${loop.endSeconds}`)
  }
  return loop
}

function validateCredit(v: unknown, path: string): Credit {
  const r = expectRecord(v, path)
  return {
    sourceId: expectString(r.sourceId, `${path}.sourceId`),
    title: expectString(r.title, `${path}.title`),
    citation: expectString(r.citation, `${path}.citation`),
    licence: expectString(r.licence, `${path}.licence`),
    url: expectString(r.url, `${path}.url`),
  }
}

/**
 * Validates an unknown JSON payload as a `Manifest`. Throws with a path-qualified message on
 * the first problem found, including a mismatched `schemaVersion` — that check comes first so
 * an incompatible manifest is rejected before any downstream field even looks wrong.
 */
export function validateManifest(json: unknown): Manifest {
  const root = expectRecord(json, 'Manifest')

  const schemaVersion = root.schemaVersion
  if (schemaVersion !== 1) {
    throw new Error(`Manifest.schemaVersion: expected 1, got ${JSON.stringify(schemaVersion)}`)
  }

  return {
    schemaVersion: 1,
    buildId: expectString(root.buildId, 'Manifest.buildId'),
    assetBase: expectString(root.assetBase, 'Manifest.assetBase'),
    scenes: expectArray(root.scenes, 'Manifest.scenes').map((s, i) => validateScene(s, `Manifest.scenes[${i}]`)),
    chapters: expectArray(root.chapters, 'Manifest.chapters').map((c, i) =>
      validateChapter(c, `Manifest.chapters[${i}]`),
    ),
    layers: expectArray(root.layers, 'Manifest.layers').map((l, i) =>
      validateLayerManifest(l, `Manifest.layers[${i}]`),
    ),
    events: expectArray(root.events, 'Manifest.events').map((e, i) => parseTimelineEvent(e, `Manifest.events[${i}]`)),
    // Lenient: absent on any manifest (or the committed stub) published before ADR-023, in
    // which case there are no stems to report rather than a parse failure.
    audioStems:
      root.audioStems === undefined
        ? []
        : expectArray(root.audioStems, 'Manifest.audioStems').map((s, i) =>
            validateAudioStem(s, `Manifest.audioStems[${i}]`),
          ),
    credits: expectArray(root.credits, 'Manifest.credits').map((c, i) => validateCredit(c, `Manifest.credits[${i}]`)),
  }
}

// ---------------------------------------------------------------------------- layer data

export type LayerData = SeriesData | RasterData | TreeData | EventsData | FeatureSetData | TerritoryData

/**
 * Fetches and parses one layer's data file, dispatching on `dataKind` to the matching
 * curated.ts parser. `events-core`, the timeline's own `EventSet`, is inlined in
 * `Manifest.events` instead and is never itself a `manifest.layers` entry — but a *non*-
 * timeline `EventSet` (docs/GLOBE.md §6, e.g. `globe-regimes`) publishes exactly like any
 * other layer, as an `EventsData` file this fetches and parses the same way.
 */
export async function loadLayerData(manifest: Manifest, entry: LayerManifest): Promise<LayerData> {
  const url = `${manifest.assetBase}/${entry.data}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`${url}: fetch failed with status ${res.status}`)
  }
  const json: unknown = await res.json()

  switch (entry.dataKind) {
    case 'scalar':
      return parseSeriesData(json)
    case 'raster':
      return parseRasterData(json)
    case 'node':
      return parseTreeData(json)
    case 'events':
      return parseEventsData(json)
    case 'features':
      return parseFeatureSetData(json)
    case 'territories':
      return parseTerritoryData(json)
  }
}
