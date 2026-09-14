/**
 * The Layer interface. NORMATIVE — see docs/DESIGN.md §10.
 *
 * Everything on screen is a pure function of one number. `sample()` reading anything other
 * than `t` is a bug: it is what makes scrubbing, playback and speed control the same
 * mechanism rather than three implementations.
 */

/** Years before present. Positive into the past. Present = 0. */
export type GeoTime = number

export const EARTH_FORMATION: GeoTime = 4.567e9

/** Where a layer draws itself. */
export type LayerSurface = 'globe' | 'timeline-lane' | 'hud' | 'scene-overlay'

export type Interpolation = 'linear' | 'log-linear' | 'step' | 'nearest'

// --------------------------------------------------------------------------- values

export interface ScalarValue {
  kind: 'scalar'
  value: number
  unit: string
  /** Proxy records have wide error bars. Carry them; the chart renders the band. */
  bounds?: [number, number]
}

export interface TimelineEvent {
  id: string
  label: string
  /** A real interval, not decoration — most deep-time dates are contested. */
  tMin: GeoTime
  tMax: GeoTime
  /** 0..1. Drives zoom LOD: events fade in as the visible span shrinks. */
  importance: number
  description: string
  citation: string
}

export interface EventsValue {
  kind: 'events'
  events: TimelineEvent[]
}

/** Two bracketing textures plus a mix factor — the globe cross-fades them, which is what
 *  makes continental drift continuous rather than a slideshow of epochs. */
export interface RasterValue {
  kind: 'raster'
  before: string
  after: string
  /** 0 -> before, 1 -> after */
  alpha: number
}

export interface NodeValue {
  kind: 'node'
  id: string
  label: string
  representative?: string
  tDivergence: GeoTime
  /** Additive (ADR-015): the ancestor portrait to show at this `t`, when the lineage layer
   *  publishes portraits. Absent otherwise. */
  portrait?: PortraitMix
}

/** Plate grammar of an ancestor portrait (VISUAL_SPEC §10). Mirrors `PlateType` in pipeline/prompts.py. */
export type PortraitPlateType = 'SPECIMEN' | 'MICROSCOPE'

/** One published ancestor portrait (ADR-015). */
export interface PortraitPlate {
  nodeId: string
  /** The portrayed lineage node's divergence: orders plates and measures the distance between them. */
  tDivergence: GeoTime
  image: string
  plate: PortraitPlateType
  width: number
  height: number
  /** Flow fields between the next older plate and this one, when they were computed. Absent means
   *  the pair crossfades without warping. */
  morphFromOlder?: PortraitMorph
}

/**
 * Two PNG data textures bending one plate into the next. `forward` lies on the older plate's
 * grid and `backward` on the younger's; a red/green byte b decodes to (b - 128) / 127 * range
 * in plate UV, v pointing down the image (pipeline/flowfield.py).
 */
export interface PortraitMorph {
  older: string
  forward: string
  backward: string
  forwardRange: number
  backwardRange: number
  size: number
}

/** Which two plates to show and how far `to` has replaced `from` (0 shows `from` alone). The
 *  target is a pure function of `t`; the viewer rate-limits what it displays toward it. */
export interface PortraitMix {
  from: PortraitPlate
  to: PortraitPlate
  mix: number
}

export type LayerValue = ScalarValue | EventsValue | RasterValue | NodeValue

// ---------------------------------------------------------------------------- layer

export interface Layer<V extends LayerValue = LayerValue> {
  id: string
  name: string
  /** [newest, oldest] in years BP. Outside this, sample() returns null and the layer
   *  renders as absent rather than substituting a plausible number. */
  timeDomain: [GeoTime, GeoTime]
  surface: LayerSurface
  /** Curated dataset id this layer reads, for credits and provenance. */
  source: string

  /** MUST be pure in `t`. No fetching, no refs, no component state. */
  sample(t: GeoTime): V | null

  /** Optional: expands to a full-width chart docked to the timeline. Because the chart
   *  shares the timeline's warped x-axis, the value under the playhead sits above it. */
  chartable?: boolean
}

// ------------------------------------------------------------------- timeline scales

export type ScaleKind = 'symlog' | 'density' | 'linear'

/**
 * Maps time to normalised screen position and back.
 *
 * `linear` is deliberately near-useless and that is the point: animating symlog -> linear
 * collapses all of human history to sub-pixel width, which is the most effective
 * educational moment in the product (DESIGN §3).
 */
export interface TimeScale {
  kind: ScaleKind
  /** years BP -> 0..1 across the visible span */
  toUnit(t: GeoTime): number
  /** 0..1 -> years BP. Must round-trip with toUnit to within 1e-6. */
  fromUnit(u: number): GeoTime
  domain: [GeoTime, GeoTime]
}

/**
 * Two playback modes (ADR-016), sharing one `speed` multiplier:
 * - `'scenes'` (default) — the playhead paces itself so every scene gap takes the same
 *   wall-clock time to cross regardless of how many years it spans, plus a small bonus for
 *   gaps that cover a lot of the timeline. See `scene/pacing.ts`'s `scenePlaybackSegments`
 *   and `timeline/playback.ts`'s `advancePlayhead`.
 * - `'steady'` — constant velocity in the full-domain scale of whichever `ScaleKind` is
 *   currently selected (symlog by default; linear when the linear toggle is on). No pacing.
 */
export type PlaybackMode = 'scenes' | 'steady'

/** Playback advances at constant velocity in *warped* space — constant events per second,
 *  not years per second. A linear playthrough would spend 99.98% of its runtime in the
 *  Proterozoic. Speed control is a multiplier on this and nothing else changes. */
export interface Playback {
  playing: boolean
  /** Screen-space units per second, before the speed multiplier. Used directly in `'steady'`
   *  mode and as the flat rate outside every scene's span in `'scenes'` mode. */
  baseRate: number
  speed: number
  mode: PlaybackMode
}
