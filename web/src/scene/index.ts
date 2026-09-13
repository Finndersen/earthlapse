/**
 * Public API of the scene package (DESIGN §5 v1 note / ADR-009: still no depth/displacement,
 * but the transition is a real shader dissolve now, not a flat cross-fade).
 *
 * `<SceneView t scenes assetBase renderCaption? className? />` — prop-driven, pure in `t`
 * (plus the OS reduced-motion preference; see `useReducedMotion`). `scenes` is
 * `Manifest.scenes` as-is (sorted ascending by `t`); `assetBase` is `Manifest.assetBase`.
 * `renderCaption`, if given, is called with the dominant scene of the current dissolve and
 * its cross-fade opacity (`captionOpacity`, in sync with the image dissolve); its return
 * value is rendered as-is — SceneView applies no positioning or styling to it.
 *
 * The pure logic is exported separately, for callers (e.g. a minimap or a scrubber preview)
 * that need it without the component:
 * - `sceneAt(scenes, t)` — the from/to/mix sampler. `DISSOLVE_WIDTH` is its one tunable: the
 *   fraction of the log1p gap between two scenes spent dissolving, centred on the midpoint.
 * - `dominantScene(mix)` / `captionOpacity(mix)` — which scene reads as "current", and that
 *   scene's caption cross-fade opacity.
 * - `driftAt(scenes, index, t)` — a scene's camera-drift uniforms (zoom + lateral pan).
 * - `transitionUniforms(mix)` — the dissolve/blur-through shader uniforms.
 */

export { REST_DRIFT, driftAt } from './drift'
export type { DriftUniforms } from './drift'
export { captionOpacity, dominantScene, DISSOLVE_WIDTH, resolveAssetUrl, sceneAt } from './scene'
export type { SceneMix } from './scene'
export { SceneView } from './SceneView'
export type { SceneViewProps } from './SceneView'
export { transitionUniforms } from './transition'
export type { TransitionUniforms } from './transition'
