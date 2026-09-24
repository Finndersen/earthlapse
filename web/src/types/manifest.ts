/**
 * The published manifest. NORMATIVE.
 *
 * `earthlapse publish` emits one manifest.json; the viewer fetches it and needs nothing else
 * to know what exists. It is the only contract between the offline pipeline and the
 * frontend, so both sides validate against this file.
 *
 * Media paths are relative to `assetBase`, so the same manifest works against a local dev
 * directory or the R2 bucket without rewriting.
 */

import type { GeoTime, Interpolation, LayerSurface, TimelineEvent } from './layer'

export interface Manifest {
  /** Bumped whenever this schema changes incompatibly. Viewer refuses a mismatch loudly
   *  rather than rendering a half-broken page. */
  schemaVersion: 1
  /** Build digest, for cache-busting and for tying a page back to a pipeline run. */
  buildId: string
  /** Every media path in this manifest is relative to this base. `shell/manifest.ts` sets it
   *  from wherever the manifest itself was fetched, so what `earthlapse publish` writes here is
   *  only a default for a consumer that reads the file without fetching it. */
  assetBase: string
  scenes: Scene[]
  chapters: Chapter[]
  layers: LayerManifest[]
  events: TimelineEvent[]
  /** The ambience stem catalogue (ADR-023). Always present, like `events` — an empty array is
   *  already a complete "no stems published yet", not an absent field. */
  audioStems: AudioStem[]
  credits: Credit[]
}

// --------------------------------------------------------------------------- scenes

/** How a scene's optional ambience stem attaches to it (ADR-023). `'loop'` ties the stem's
 *  gain to the scene's own on-screen presentation weight (the same mix
 *  `scene/presentation.ts` computes for the cross-dissolve) — pure in `t`, scrub-safe by
 *  construction. `'once'` fires a single playback when the scene becomes the settled
 *  on-screen scene during playback (not while scrubbing past it), re-armed only after the
 *  viewer leaves and returns. */
export type SoundMode = 'loop' | 'once'

/** A scene's optional associated ambience stem (ADR-023). `stem` names an id in
 *  `Manifest.audioStems`. */
export interface SceneSound {
  stem: string
  mode: SoundMode
  /** 0..1, mixed against the stem's own master gain. */
  gain: number
}

export interface SceneCoordinates {
  lat: number
  lon: number
}

/**
 * A scene's real-world place (ADR-034). `presentDay` is the curated present-day coordinates,
 * published alongside the reconstruction so it stays auditable. `marker` is what the globe
 * actually plots: identical to `presentDay` inside the human-era basemap domain, a plate-
 * reconstructed paleo position for an older scene, and `null` when no plate model covers that
 * scene's age. The globe must show **no marker at all** for a `null` marker — never falling
 * back to `presentDay`, which would place an ancient scene on a modern coastline.
 */
export interface SceneLocation {
  label: string
  presentDay: SceneCoordinates
  marker: SceneCoordinates | null
}

/** Upper bound of `SceneFraming.portraitZoom`: beyond it a phone upscales the still enough to
 *  visibly soften it. */
export const MAX_PORTRAIT_ZOOM = 1.5

/**
 * Where the viewer crops a scene's still and which way its camera drift travels (ADR-045).
 * `focus` is `[x, y]` in fractions of the image's own width and height, origin top-left, y down:
 * the cover-fit crop centres its window on it along whichever axis the viewport crops, clamped so
 * the window stays inside the image (`scene/framing.ts`). `pan` is the direction the camera
 * travels across the image over the drift, in degrees in `[0, 360)`: 0 toward the right edge,
 * 90 toward the bottom, 180 left, 270 up — so the content slides the opposite way on screen.
 * `portraitZoom`, in `[1, MAX_PORTRAIT_ZOOM]`, shrinks the window by that factor in both
 * dimensions in a portrait viewport only, so `focus` then places it vertically too (ADR-047).
 * Absent means 1.
 */
export interface SceneFraming {
  focus: [number, number]
  pan: number
  portraitZoom?: number
}

export interface Scene {
  id: string
  t: GeoTime
  chapterId: string
  image: string
  /** A small (`pipeline.transcode.THUMBNAIL_SIZE`-square) derivative of `image`, backing the
   *  timeline checkpoint pip's hover preview (`ScrubTrack.module.css`'s `.pipThumb`). Always
   *  emitted, like `image` — use this, never `image`, for the pip preview; fetching the full
   *  still to back a 44px circular preview is wasteful. */
  thumbnail: string
  /** Depth map for 2.5D displacement. Absent in v1 — deferred by ADR-009. The field
   *  exists now so adding it later is a publish, not a schema migration. */
  depth?: string
  /** Shot type from the camera grammar (VISUAL_SPEC §3). */
  shot: 'WIDE_RIDGE' | 'WATER_EDGE' | 'CANOPY' | 'GROUND' | 'SPLIT_LEVEL'
  /** Short heading naming what the scene depicts — the timeline checkpoint pip's label and the
   *  subtitle's headline above `caption`'s longer passage. Required, like `caption`: every
   *  published scene names itself. */
  title: string
  caption: string
  /** events-core event id(s) this scene visually anchors to (ADR-022). Optional: absent on any
   *  manifest published before this field existed. */
  events?: string[]
  /** The scene's optional associated ambience stem (ADR-023). Additive: absent on any manifest
   *  published before this field existed, and on any scene with no associated sound. */
  sound?: SceneSound
  /** The scene's real-world place, if it depicts one (ADR-034). Additive: absent on any manifest
   *  published before this field existed, and on any scene with no specific location. */
  location?: SceneLocation
  /** The scene's crop focus and drift direction (ADR-045). Additive: absent on any manifest
   *  published before this field existed, and on any scene shown with a centred crop and a
   *  drift direction derived from its id. */
  framing?: SceneFraming
  /** Digest of the approved asset. Present means pinned (ADR-005). */
  pinned?: string
  width: number
  height: number
}

/** One run of scenes sharing composition. Within a chapter run the framing holds and only the
 *  world changes; a boundary between two runs reads as a cut (DESIGN §6). A chapter id may
 *  appear more than once in `Manifest.chapters` (ADR-020): each non-adjacent run of the same
 *  chapter is its own entry with its own `tStart`/`tEnd` span, so `id` is not unique across
 *  the array — treat each element as an independent run, never key this array by `id`. */
export interface Chapter {
  id: string
  label: string
  tStart: GeoTime // nearer the present
  tEnd: GeoTime // further into the past
  /** Hand-approved anchor every scene in this chapter conditioned on (ADR-004). */
  anchorImage?: string
}

// --------------------------------------------------------------------------- layers

/** ADR-035 added `'features'` (a `FeatureSet` layer file, e.g. `cities`); ADR-059 added
 *  `'territories'` (a `TerritoryData` layer file, e.g. `empires`, whose polygons live in a separate
 *  geometry file the globe fetches lazily). */
export type LayerDataKind = 'scalar' | 'events' | 'raster' | 'node' | 'features' | 'territories'

export interface LayerManifest {
  id: string
  name: string
  surface: LayerSurface
  dataKind: LayerDataKind
  timeDomain: [GeoTime, GeoTime]
  /** Curated dataset id, matched to a Credit entry. */
  source: string
  chartable: boolean
  unit?: string
  interpolation?: Interpolation
  /** Where the layer's data lives, relative to assetBase. Scalars and trees are inlined
   *  as JSON; raster sequences are a frame index pointing at texture files. */
  data: string
}

// ----------------------------------------------------------------------------- audio

/** One published ambience stem (ADR-023) — DESIGN.md §11 tier 1. Independently credited here
 *  (`title`/`author`/`licence`/`sourceUrl`) rather than through `Credit`, which stays one
 *  entry per source directory: a stems collection bundles several independently-licensed
 *  files under one `sources/audio-stems/` directory, so per-file credit has to live on the
 *  stem itself. */
export interface AudioStem {
  id: string
  /** Published path, relative to `assetBase`. */
  file: string
  title: string
  author: string
  licence: string
  sourceUrl: string
  durationSeconds: number
  /** `false` marks a one-shot: played only by a scene's `once` sound, never looped. */
  loopSafe: boolean
  /** dB applied on top of every curve or scene gain so each stem reaches the mix at its
   *  reference loudness (ADR-023 amendment "stem levels"). */
  levelTrimDb: number
  /** The span a looping player repeats. Absent: the whole clip. */
  loop?: AudioLoop
  /** Playback start offset in seconds, for a one-shot only — skips a silent (or otherwise
   *  unwanted) lead-in so playback starts right on the scene's `once` trigger. Absent: starts
   *  at 0. Additive: absent on any manifest published before this field existed. */
  startSeconds?: number
}

export interface AudioLoop {
  startSeconds: number
  endSeconds: number
}

// -------------------------------------------------------------------------- credits

/** Generated from every source's manifest.toml. Not optional — these datasets are
 *  academic and citation is the price of use. */
export interface Credit {
  sourceId: string
  title: string
  citation: string
  licence: string
  url: string
}
