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

/** Playback advances at constant velocity in *warped* space — constant events per second,
 *  not years per second. A linear playthrough would spend 99.98% of its runtime in the
 *  Proterozoic. Speed control is a multiplier on this and nothing else changes. */
export interface Playback {
  playing: boolean
  /** Screen-space units per second, before the speed multiplier. */
  baseRate: number
  speed: number
}
