/**
 * The published manifest. NORMATIVE.
 *
 * `earthtime publish` emits one manifest.json; the viewer fetches it and needs nothing else
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
  assetBase: string
  scenes: Scene[]
  chapters: Chapter[]
  layers: LayerManifest[]
  events: TimelineEvent[]
  credits: Credit[]
}

// --------------------------------------------------------------------------- scenes

export interface Scene {
  id: string
  t: GeoTime
  chapterId: string
  /** The generated still. */
  image: string
  /** Depth map for 2.5D displacement. Absent in v1 — deferred by ADR-009. The field
   *  exists now so adding it later is a publish, not a schema migration. */
  depth?: string
  /** Shot type from the camera grammar (VISUAL_SPEC §3). 'UNDERWATER' added by ADR-014 for
   *  fully submerged shots (e.g. the Cambrian seafloor); additive, no scene used it before. */
  shot: 'WIDE_RIDGE' | 'WATER_EDGE' | 'CANOPY' | 'GROUND' | 'UNDERWATER'
  caption: string
  /** Digest of the approved asset. Present means pinned (ADR-005). */
  pinned?: string
  width: number
  height: number
}

/** A run of scenes sharing composition. Within a chapter the framing holds and only the
 *  world changes; a chapter boundary reads as a cut (DESIGN §6). */
export interface Chapter {
  id: string
  label: string
  tStart: GeoTime // nearer the present
  tEnd: GeoTime // further into the past
  /** Hand-approved anchor every scene in this chapter conditioned on (ADR-004). */
  anchorImage?: string
}

// --------------------------------------------------------------------------- layers

export type LayerDataKind = 'scalar' | 'events' | 'raster' | 'node'

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
