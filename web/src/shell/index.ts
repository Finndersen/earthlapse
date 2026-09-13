/**
 * Public API of the `shell` package (W11).
 *
 * `ShellLayout` is a pure, prop-driven layout component — it takes ReactNode slots and owns
 * only chrome (the lens vignette, periphery placement, idle calm), never content or the `t`
 * store. `useIdle` is the input-idle detector behind idle calm; the caller decides when it is
 * armed and passes the result to `ShellLayout`'s `calm`. `loadManifest` and `loadLayerData`
 * are plain async functions with no store dependency either; call them from a client
 * component (or an effect) and hand the result to whatever needs it.
 */

export { ShellLayout, type ShellLayoutProps } from './ShellLayout'
export { useIdle, type UseIdleOptions } from './useIdle'
export {
  loadLayerData,
  loadManifest,
  validateManifest,
  type LayerData,
  type ManifestLoadResult,
} from './manifest'
