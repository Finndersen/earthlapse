/**
 * web/src/layers — data layer factories and prop-driven HUD components (DESIGN §10, §8).
 * Wraps curated `SeriesData`/`TreeData` (parsed via `@/data/curated`) in the `Layer` contract
 * from `@/types/layer`, and renders them.
 *
 * Factories (`createScalarLayer`, `createNodeLayer`, `createEventsLayer`) close only over
 * `entry`/`data`, never mutate them — `sample(t)` is pure, `null` outside `entry.timeDomain` or
 * the data's own sample range, whichever is narrower.
 *
 * Components are all prop-driven (`layer`, `t`, and `scale` where a chart needs the timeline's
 * warp) — nothing read from a store, ref, or fetch. `t` outside a layer's domain renders as "no
 * data" text, never a false `0`. See each component's own doc comment for its specific contract
 * (`Sparkline`'s domain-warping choice, `AncestorPortrait`'s morph timing, etc.) — not repeated
 * here.
 *
 * `HUD_HIDDEN_LAYER_IDS`/`isHiddenFromHud` (`./hudVisibility.ts`) is a display-only, reversible
 * HUD filter — the layer, its data, and its sampling are untouched.
 *
 * `useThrottledValue` (`@/lib/useThrottledValue`) is a generic, reusable throttle — `ScalarReadout`
 * and `Sparkline` each use it internally on the `t` they're given, so the per-frame `t` writes
 * `Experience.tsx`'s playback loop produces only redo their sampling/rendering a few times a
 * second, not every frame. Purely a render-rate optimisation: it never changes what a component
 * displays, only how often it recomputes the display.
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
