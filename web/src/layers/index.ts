/**
 * web/src/layers — data layer factories and prop-driven HUD components (DESIGN §10, §8).
 * Wraps curated `SeriesData`/`TreeData` (parsed via `@/data/curated`) in the `Layer`
 * contract from `@/types/layer`, and renders them.
 *
 * ## Factories
 * - `createScalarLayer(entry, data)` — wraps a `SeriesData` series (CO₂, temperature, day
 *   length, ...) as `Layer<ScalarValue>`.
 * - `createNodeLayer(entry, data)` — wraps a `TreeData` lineage as `Layer<NodeValue>`.
 *
 * Both close only over `entry` and `data`, neither of which they ever mutate — `sample(t)`
 * is pure, and `null` outside `entry.timeDomain` or the data's own sample range, whichever
 * is narrower.
 *
 * ## Components — props contract for the integrator (W12)
 *
 * Every component here is prop-driven: `layer`, `t`, and (where a chart needs the timeline's
 * warp) `scale` come in as props. Nothing is read from a store, a ref, or a fetch. `t`
 * outside a layer's domain renders as "no data" text — never a false `0`.
 *
 * - `<Sparkline layer t scale />` — small inline SVG trend line across `scale`'s full span,
 *   with a playhead marker; gaps where the layer has no data are simply not drawn.
 * - `<ScalarReadout layer t />` — `value unit` (+ bounds if present), or "no data".
 * - `<LayerChart layer t scale />` — full-width chart docked to the timeline, sharing its
 *   `TimeScale` so the value under the playhead sits directly above it; renders the
 *   uncertainty band when the layer carries `bounds`. Collapsed by default; click the title
 *   bar to expand (local UI state only, not part of the `t` model).
 * - `<DayLengthClock layer t />` — a small clock face plus the numeric reading, for a
 *   `Layer<ScalarValue>` whose unit is hours.
 * - `<AncestorReadout layer t />` — label, representative organism, "since <t>"; text only
 *   in v1 (DESIGN §10).
 */

export { createNodeLayer, createScalarLayer } from './factories'

export { AncestorReadout, type AncestorReadoutProps } from './components/AncestorReadout'
export { DayLengthClock, type DayLengthClockProps } from './components/DayLengthClock'
export { LayerChart, type LayerChartProps } from './components/LayerChart'
export { ScalarReadout, type ScalarReadoutProps } from './components/ScalarReadout'
export { Sparkline, type SparklineProps } from './components/Sparkline'
