/**
 * web/src/layers — data layer factories and prop-driven HUD components (DESIGN §10, §8).
 * Wraps curated `SeriesData`/`TreeData` (parsed via `@/data/curated`) in the `Layer`
 * contract from `@/types/layer`, and renders them.
 *
 * ## Factories
 * - `createScalarLayer(entry, data)` — wraps a `SeriesData` series (CO₂, temperature, day
 *   length, ...) as `Layer<ScalarValue>`.
 * - `createNodeLayer(entry, data)` — wraps a `TreeData` lineage as `Layer<NodeValue>`.
 * - `createEventsLayer(entry, data)` — wraps a non-timeline `EventsData` (docs/GLOBE.md §6,
 *   e.g. `globe-regimes`) as `Layer<EventsValue>`.
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
 * - `<Sparkline layer t scale />` — small inline SVG trend line across the layer's OWN domain
 *   (warped in `scale`'s `kind`, not `scale`'s own domain — see that component's doc comment for
 *   why: a shared full-Earth-domain `scale`, sampled directly, starves a narrow-domain layer like
 *   population of any usable resolution), with a playhead marker; gaps where the layer has no
 *   data are simply not drawn.
 * - `<ScalarReadout layer t />` — `value unit` (+ bounds if present), or "no data".
 * - `<LayerChart layer t scale onClose />` — full-width chart docked to the timeline, sharing
 *   its `TimeScale` so the value under the playhead sits directly above it; renders the
 *   uncertainty band when the layer carries `bounds`. Always fully drawn — whether it is open
 *   is the caller's state; `onClose` is its own close button.
 * - `<AncestorReadout layer t />` — label, representative organism, "since <t>".
 * - `<AncestorPortrait layer t assetBase portraits />` — the ancestor's specimen plate,
 *   flow-morphing into the next across a band centred on each divergence (ADR-015); renders
 *   nothing when the lineage publishes no portrait at `t`. Its target is pure in `t`; the
 *   displayed morph is rate-limited to a minimum duration. `portraits` (the lineage's
 *   `PortraitIndex`, or `null`) is used only to preload neighbouring plates/flow textures.
 * - `<AncestorPanel layer t assetBase portraits />` — `<AncestorPortrait>` above
 *   `<AncestorReadout>` in the ancestor slot; use this rather than composing the two yourself,
 *   since it also carries the alignment that keeps the portrait's edge locked to the readout
 *   text's.
 *
 * ## Portrait helpers (pure)
 * - `portraitAt(index, t)` / `indexPortraits(data)` — the portrait target; `MORPH_BAND_FRACTION`
 *   is its one tunable.
 * - `portraitDrawState(mix)` — older/younger/alpha/morph in draw order.
 * - `portraitNeighbourUrls(index, older, younger, assetBase)` — the plates/flow textures just
 *   outside the drawn pair, for `<AncestorPortrait>`'s neighbour preload.
 * - `decodeFlowByte(byte, range)` — the flow texture encoding.
 *
 * ## HUD visibility (display-only, reversible)
 * - `isHiddenFromHud(layerId)` / `HUD_HIDDEN_LAYER_IDS` — layers to exclude from the HUD's
 *   scalar readout list despite being HUD-surfaced and chartable in the manifest (currently just
 *   `co2`, see `./hudVisibility.ts`). The layer, its curated data, and its sampling are
 *   untouched; only its presence in `Experience.tsx`'s `hudScalarEntries` is gated.
 */

export { createEventsLayer, createNodeLayer, createScalarLayer } from './factories'
export {
  decodeFlowByte,
  indexPortraits,
  MIN_PORTRAIT_TRANSITION_SECONDS,
  MORPH_BAND_FRACTION,
  portraitAt,
  portraitDrawState,
  portraitNeighbourUrls,
  type PortraitDrawState,
  type PortraitIndex,
} from './portraits'

export { HUD_HIDDEN_LAYER_IDS, isHiddenFromHud } from './hudVisibility'

export { AncestorPanel, type AncestorPanelProps } from './components/AncestorPanel'
export { AncestorPortrait, type AncestorPortraitProps } from './components/AncestorPortrait'
export { AncestorReadout, type AncestorReadoutProps } from './components/AncestorReadout'
export { LayerChart, type LayerChartProps } from './components/LayerChart'
export { ScalarReadout, type ScalarReadoutProps } from './components/ScalarReadout'
export { Sparkline, type SparklineProps } from './components/Sparkline'
