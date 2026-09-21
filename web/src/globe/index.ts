/**
 * Public API of `web/src/globe` (DESIGN §7, docs/GLOBE.md) — the independent three.js globe view.
 *
 * `<Globe>` is fully prop-driven (no global store): it re-derives everything from `t` and its
 * props on every render, composing raster data, pre-1 Ga regimes and overlay effects, a caption
 * slot, and the human-civilisation layer (ADR-031/032/035 — arcs, inhabited markers, the HYDE
 * density shader term and city markers under one legend toggle, sharing one tooltip).
 *
 * Data-honesty rules worth knowing before changing anything here: the two raster sources
 * (PaleoDEM below the 540 Ma seam, Merdith et al. 2021 above it) are crossfaded across a labelled
 * band rather than presented as agreeing (`SEAM_BAND`); an unusable Merdith source
 * (`neoproterozoic: null`) falls back to the "geography unknown" regime look rather than faking
 * continents or blanking the sphere (`regimeEventsWithRasterFallback`); and a span with nothing
 * published gets `NO_RECONSTRUCTION_CAPTION` rather than showing nothing.
 *
 * Prop constraints that are not obvious from the types:
 * - `regimeEvents` / `effectEvents` must be the *full, unfiltered* event lists, not a
 *   `Layer<EventsValue>.sample(t)` slice — see `./effects`.
 * - `sceneLocation` (ADR-034): only its `marker` is ever plotted, never `presentDay`.
 * - `playbackBaseRate` is `Playback.baseRate`; the human layer sizes arrival timing against the
 *   timeline's own rate model so an arc is legible rather than a flicker at 1x.
 * - `expanded` is controlled — the caller owns the boolean and `onToggleExpand` flips it.
 *
 * Textures load on demand into a bounded LRU cache, preloading a few frames in the direction `t`
 * is travelling (ADR-013) including across `SEAM_BAND`; the last bound pair stays on screen until
 * the next has loaded, so the globe never shows a blank frame.
 *
 * The pure cores (`blend.ts`'s `globeBlendAt`/`globeMulti*`/`globeUniforms`, `./effects`,
 * `./poles`, `arcs.ts`, `cities.ts`, `density.ts`, `sceneLocation.ts`) are exported separately
 * because they carry no WebGL dependency and are unit-tested without a canvas.
 */

export {
  globeBlendAt,
  globeMultiBlendAt,
  globeMultiCaptionFor,
  globeMultiPreloadUrls,
  globePreloadUrls,
  globeUniforms,
  NO_RECONSTRUCTION_CAPTION,
  regimeEventsWithRasterFallback,
  SEAM_BAND,
  travelDirection,
} from './blend'
export * from './effects'
export { Globe } from './Globe'
export type { GlobeProps } from './Globe'
export { isPoleVisible, poleDirection, POLE_VISIBILITY_MARGIN } from './poles'
export type { PoleId } from './poles'
// The globe's single raster-overlay slot (ADR-041): the closed registry `Experience.tsx` reads to
// resolve which published layer each selectable kind binds, and `OverlaySelect` reads to render
// its options.
export { GLOBE_OVERLAYS, GLOBE_OVERLAY_KINDS } from './overlay'
export type { GlobeOverlayKind } from './overlay'
// Sphere<->Equal Earth map projection (ADR-033), exported for lat/lon-placed overlays drawn on
// top of both the globe and the map.
export {
  EQUAL_EARTH_HALF_HEIGHT,
  EQUAL_EARTH_HALF_WIDTH,
  lonLatToMap,
  lonLatToSphere,
  PROJECTION_GLSL,
  splitAtAntimeridian,
  unfoldedPosition,
} from './projection'
export type { GlobeBlend, GlobeRasterLayers, GlobeUniformValues, PreloadWindow, TravelDirection } from './blend'
