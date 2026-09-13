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
 * - `<LayerChart layer t scale onClose />` — full-width chart docked to the timeline, sharing
 *   its `TimeScale` so the value under the playhead sits directly above it; renders the
 *   uncertainty band when the layer carries `bounds`. Always fully drawn — whether it is open
 *   is the caller's state; `onClose` is its own close button.
 * - `<DayLengthClock layer t />` — a small clock face plus the numeric reading, for a
 *   `Layer<ScalarValue>` whose unit is hours.
 * - `<AncestorReadout layer t />` — label, representative organism, "since <t>".
 * - `<AncestorPortrait layer t assetBase />` — the ancestor's specimen plate, flow-morphing
 *   into the next across a band after each divergence (ADR-015); renders nothing when the
 *   lineage publishes no portrait at `t`. Place it above `<AncestorReadout>` in the ancestor
 *   slot. Its target is pure in `t`; the displayed morph is rate-limited to a minimum duration.
 *
 * ## Portrait helpers (pure)
 * - `portraitAt(index, t)` / `indexPortraits(data)` — the portrait target; `MORPH_BAND_FRACTION`
 *   is its one tunable.
 * - `portraitDrawState(mix)` — older/younger/alpha/morph in draw order.
 * - `decodeFlowByte(byte, range)` — the flow texture encoding.
 */

export { createNodeLayer, createScalarLayer } from './factories'
export {
  decodeFlowByte,
  indexPortraits,
  MIN_PORTRAIT_TRANSITION_SECONDS,
  MORPH_BAND_FRACTION,
  portraitAt,
  portraitDrawState,
  type PortraitDrawState,
  type PortraitIndex,
} from './portraits'

export { AncestorPortrait, type AncestorPortraitProps } from './components/AncestorPortrait'
export { AncestorReadout, type AncestorReadoutProps } from './components/AncestorReadout'
export { DayLengthClock, type DayLengthClockProps } from './components/DayLengthClock'
export { LayerChart, type LayerChartProps } from './components/LayerChart'
export { ScalarReadout, type ScalarReadoutProps } from './components/ScalarReadout'
export { Sparkline, type SparklineProps } from './components/Sparkline'
