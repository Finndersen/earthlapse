/**
 * Public API of the scene package (DESIGN §5 v1 note / ADR-009: still no depth/displacement;
 * ADR-012: a smooth whole-image crossfade with a minimum wall-clock duration, replacing the
 * noise-masked dissolve).
 *
 * `<SceneView t scenes assetBase minHoldSeconds renderCaption? className? />` — prop-driven, pure in `t`
 * (plus the OS reduced-motion preference and the presentation catch-up's own wall-clock
 * pacing; see `useReducedMotion` and `presentation.ts`). `scenes` is `Manifest.scenes` as-is
 * (sorted ascending by `t`); `assetBase` is `Manifest.assetBase`. `renderCaption`, if given,
 * is called with the dominant scene of the current dissolve and its cross-fade opacity
 * (`captionOpacity`, in sync with the image dissolve); its return value is rendered as-is —
 * SceneView applies no positioning or styling to it.
 *
 * The pure logic is exported separately, for callers (e.g. a minimap or a scrubber preview)
 * that need it without the component:
 * - `sceneAt(scenes, t)` — the from/to/mix *target* sampler, instantaneous and pure in `t`.
 *   `DISSOLVE_WIDTH` is its one tunable: the fraction of the log1p gap between two scenes
 *   spent dissolving, centred on the midpoint.
 * - `step(state, target, dtSeconds)` — rate-limits a *presented* `SceneMix` toward `sceneAt`'s
 *   target, at most `dtSeconds / MIN_TRANSITION_SECONDS` of `mix` per call.
 *   `advance(presentation, target, dtSeconds, minHoldSeconds)` adds a minimum on-screen hold
 *   for settled scenes (`PLAYBACK_HOLD_SECONDS` during playback), and
 *   `usePresentedSceneMix(target, minHoldSeconds)` drives it with `requestAnimationFrame`.
 * - `dominantScene(mix)` / `captionOpacity(mix)` — which scene reads as "current", and that
 *   scene's caption cross-fade opacity.
 * - `driftAt(scenes, index, t)` — a scene's camera-drift uniforms (zoom + lateral pan).
 * - `crossfadeAlpha(mix)` — the eased image-blend alpha (`shaders.ts`'s fragment shader mixes
 *   `uFrom`/`uTo` gamma-correctly by this amount).
 */

export { REST_DRIFT, driftAt } from './drift'
export type { DriftUniforms } from './drift'
export { advance, MIN_TRANSITION_SECONDS, PLAYBACK_HOLD_SECONDS, step, usePresentedSceneMix } from './presentation'
export type { Presentation } from './presentation'
export { captionOpacity, dominantScene, DISSOLVE_WIDTH, resolveAssetUrl, sceneAt } from './scene'
export type { SceneMix } from './scene'
export { SceneView } from './SceneView'
export type { SceneViewProps } from './SceneView'
export { crossfadeAlpha } from './transition'
