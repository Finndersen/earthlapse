/**
 * Public API of the `shell` package (W11).
 *
 * `ShellLayout` is a pure, prop-driven layout component — it takes ReactNode slots and owns
 * only chrome (surround, vignette, dock), never content or the `t` store. `loadManifest` and
 * `loadLayerData` are plain async functions with no store dependency either; call them from
 * a client component (or an effect) and hand the result to whatever needs it.
 */

export { ShellLayout, type ShellLayoutProps } from './ShellLayout'
export {
  loadLayerData,
  loadManifest,
  validateManifest,
  type LayerData,
  type ManifestLoadResult,
} from './manifest'
