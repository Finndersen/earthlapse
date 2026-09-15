/**
 * Public API of the `shell` package (W11).
 *
 * `ShellLayout` is a pure, prop-driven layout component — it takes ReactNode slots and owns
 * only chrome (the lens vignette, periphery placement, the About & credits panel), never
 * content or the `t` store. `Panel` is the one shared accessible dialog primitive (focus trap,
 * Escape, focus restore, click-outside, phone bottom sheet) that `ShellLayout` builds its
 * credits panel on — reuse it for any other panel-shaped UI rather than writing a second one.
 * `CreditsList` is the credits content itself, shared by that panel and the `/credits` route.
 * `loadManifest` and `loadLayerData` are plain async functions with no store dependency either;
 * call them from a client component (or an effect) and hand the result to whatever needs it.
 */

export { ShellLayout, type ShellLayoutProps } from './ShellLayout'
export { Panel, type PanelProps } from './Panel'
export { CreditsList, type CreditsListProps } from './CreditsList'
export {
  loadLayerData,
  loadManifest,
  validateManifest,
  type LayerData,
  type ManifestLoadResult,
} from './manifest'
