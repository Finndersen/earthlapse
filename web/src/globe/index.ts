/**
 * Public API of `web/src/globe` (W8, DESIGN §7) — the independent three.js globe view.
 *
 * `<Globe t rasterData assetBase expanded onToggleExpand />` is a fully prop-driven client
 * component (no global store, per the shared web conventions): it re-derives everything it
 * shows from `t` and the given `RasterData`/`assetBase` on every render.
 *
 * - `t` — years before present (see `@/types/layer`'s `GeoTime`).
 * - `rasterData` — the parsed paleoDEM raster sequence (`@/data/curated`'s `RasterData`),
 *   e.g. from `parseRasterData` against `LayerManifest.data` for a raster-kind layer.
 * - `assetBase` — `Manifest.assetBase`; raster frame refs are resolved relative to it.
 * - `expanded` — controlled: true renders the globe as a fullscreen overlay, false as
 *   whatever size its parent gives it (the corner-widget case, DESIGN §8).
 * - `onToggleExpand` — called when the user clicks the expand/collapse button; the caller
 *   owns the `expanded` boolean and flips it.
 *
 * Outside `rasterData`'s time domain (older than its oldest frame, or newer than its
 * newest), the globe renders a neutral dim sphere and a small "no reconstruction" label
 * rather than fabricating or freezing on stale data.
 *
 * Textures are loaded on demand into a bounded LRU cache, with a few frames preloaded in the
 * direction `t` is travelling (ADR-013); the last bound pair stays on screen until the next
 * pair has loaded, so the globe never shows a blank frame.
 *
 * `globeBlendAt`, `globeUniforms` and `globePreloadUrls` are exported separately because
 * they're pure and worth reusing or testing without a WebGL context.
 */

export { globeBlendAt, globePreloadUrls, globeUniforms, travelDirection } from './blend'
export type { GlobeBlend, GlobeUniformValues, PreloadWindow, TravelDirection } from './blend'
export { Globe } from './Globe'
export type { GlobeProps } from './Globe'
