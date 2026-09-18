/**
 * Public API of `web/src/globe` (W8, DESIGN §7) — the independent three.js globe view. Covers
 * all 4.567 Ga (docs/GLOBE.md §9: G2, G5, G7 and G8 done; G6 partial — ice shell and the
 * Chicxulub/Moon-forming impacts are wired, flood basalts are not yet).
 *
 * `<Globe t rasterLayers assetBase regimeEvents effectEvents expanded onToggleExpand />` is a
 * fully prop-driven client component (no global store, per the shared web conventions): it
 * re-derives everything it shows from `t` and its other props on every render, composing
 * three independent things every frame:
 *
 * 1. **Raster data** (0-1000 Ma, §2-§4.1): `globeMultiBlendAt` picks between `rasterLayers`'s
 *    two sources by domain — PaleoDEM below the 540 Ma seam, Merdith et al. 2021's stylised
 *    continents above it — and crossfades the two across a labelled 540-550 Ma band rather
 *    than pretending they agree (`SEAM_BAND`). `neoproterozoic: null` (the Merdith source
 *    unusable) falls back to the "geography unknown" regime look instead of faking continents
 *    (`regimeEventsWithRasterFallback`), never to a blank sphere with no explanation.
 * 2. **Pre-1 Ga regimes** (§4.2, G8) and **overlay effects** (Snowball/Paleoproterozoic ice
 *    shell §4.3, Chicxulub impact winter and the Moon-forming giant impact §5.3, G6): `./effects`
 *    resolves `regimeEvents`/`effectEvents` into shader uniforms plus a caption, every frame.
 * 3. **The caption slot** (§7): whichever of the effects resolver's captions is active, or the
 *    raster fallback (`globeMultiCaptionFor`) when none is — real PaleoDEM data needs no
 *    caption, the seam and Merdith spans get their own, and a genuine gap (nothing published,
 *    nothing cited yet — today only the ~47 Myr before any cited regime starts, 4.52-4.567 Ga)
 *    gets `NO_RECONSTRUCTION_CAPTION` rather than silently showing nothing.
 *
 * Props:
 * - `t` — years before present (see `@/types/layer`'s `GeoTime`).
 * - `rasterLayers` — `{ paleodem, neoproterozoic }` (`GlobeRasterLayers`), e.g. built from
 *   `AppLayers.rasters` (`@/app/buildLayers`) by id.
 * - `assetBase` — `Manifest.assetBase`; raster frame refs are resolved relative to it.
 * - `regimeEvents` — `globe-regimes`'s full, unfiltered event list (`AppLayers.eventLayers`'s
 *   raw entry, via `@/app/buildLayers`'s `rawEvents`), `[]` if unpublished. Must be the full
 *   list, not a `Layer<EventsValue>.sample(t)` slice — see `./effects`'s own doc comment.
 * - `effectEvents` — `events-core`'s full list, i.e. `Manifest.events` (already loaded for the
 *   timeline).
 * - `expanded` — controlled: true renders the globe as a fullscreen overlay, false as
 *   whatever size its parent gives it (the corner-widget case, DESIGN §8).
 * - `onToggleExpand` — called when the user clicks the expand/collapse button; the caller
 *   owns the `expanded` boolean and flips it.
 * - `cities` — the `cities` `FeatureSet`'s features (ADR-035), `null` when unpublished.
 * - `sceneLocation` — the current scene's `location` (ADR-034), `null` for a scene with no
 *   place. Only its `marker` is ever plotted, never `presentDay`.
 * - `playbackBaseRate` — `Playback.baseRate`. The human layer derives its arrival timing from
 *   the timeline's own rate model so an arc is legible rather than a flicker at 1x.
 * - `feedEventIds` / `hoveredFeedEventId` — which event cards are showing and which is hovered,
 *   so an arrival's arc and marker pulse in sympathy with its own card.
 *
 * 4. **The human-civilisation layer** (ADR-031 amendment / ADR-032 / ADR-035), under one legend
 *    toggle: arrival arcs that are drawn only while their migration is happening and then fade
 *    (`arcs.ts`), the "inhabited" markers first settlement leaves at its destination and which
 *    themselves fade out once the arrival has played (not persisted to the present), the HYDE
 *    population-density overlay (`density.ts`, a shader term on the sphere itself) and major-city
 *    markers (`cities.ts`), with one shared tooltip (`GlobeTooltip.tsx`) across all of them.
 *
 * Textures are loaded on demand into a bounded LRU cache, with a few frames preloaded in the
 * direction `t` is travelling (ADR-013), including across `SEAM_BAND`; the last bound pair
 * stays on screen until the next pair has loaded, so the globe never shows a blank frame.
 *
 * `globeBlendAt`/`globePreloadUrls` (single-source) and their `globeMulti*` generalisations,
 * `globeUniforms`, are exported separately because they're pure and worth reusing or testing
 * without a WebGL context. Likewise `./effects`'s own exports (`resolveGlobeEffects` etc.) and
 * `./poles`'s (the pole orientation cue's visibility test — see its own doc comment). The human
 * layer's own pure cores (`arcs.ts`, `cities.ts`, `density.ts`, `sceneLocation.ts`) follow the
 * same rule and are unit-tested without a canvas.
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
// Sphere<->Equal Earth map projection (docs/GLOBE.md's ADR-033): exported for future
// lat/lon-placed overlay work (arcs, points) drawn on top of both the globe and the map — see
// this module's own doc comment.
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
