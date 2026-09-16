/**
 * Public API of the scene package (DESIGN §5 v1 note / ADR-009: still no depth/displacement;
 * ADR-012: a smooth whole-image crossfade with a minimum wall-clock duration, replacing the
 * noise-masked dissolve; updated for playback pacing — see `pacing.ts`).
 *
 * `<SceneView t scenes assetBase renderCaption? className? />` — prop-driven, pure in `t`
 * (plus the OS reduced-motion preference and the presentation catch-up's own wall-clock
 * pacing; see `useReducedMotion` and `presentation.ts`). `scenes` is `Manifest.scenes` as-is
 * (sorted ascending by `t`); `assetBase` is `Manifest.assetBase`. `renderCaption`, if given,
 * is called with the dominant scene of the current dissolve and its cross-fade opacity
 * (`captionOpacity`, in sync with the image dissolve); its return value is rendered as-is —
 * SceneView applies no positioning or styling to it.
 *
 * The pure logic is exported separately, for callers (e.g. a minimap or a scrubber preview,
 * or the `timeline` package's playback pacing) that need it without the component:
 * - `sceneAt(scenes, t)` — the from/to/mix *target* sampler, instantaneous and pure in `t`.
 *   `DISSOLVE_WIDTH` is its one tunable: the fraction of the log1p gap between two scenes
 *   spent dissolving, centred on the midpoint.
 * - `step(state, target, dtSeconds)` — rate-limits a *presented* `SceneMix` toward `sceneAt`'s
 *   target, at most `dtSeconds / MIN_TRANSITION_SECONDS` of `mix` per call.
 *   `usePresentedSceneMix(target)` drives it with `requestAnimationFrame`.
 * - `scenePlaybackSegments(scenes)` — the `PlaybackSegment`s
 *   (`{ tNewer, tOlder, durationSeconds }`) that `timeline/playback.ts`'s `advancePlayhead`
 *   paces the *playhead* through during `'scenes'`-mode playback (ADR-016), so scenes dwell
 *   and dissolves take their exact wall-clock time without ever desynchronising the picture
 *   from `t`. `SCENE_DWELL_SECONDS` and `MAX_GAP_BONUS_SECONDS` are its tunables.
 * - `dominantScene(mix)` / `captionOpacity(mix)` — which scene reads as "current", and that
 *   scene's caption cross-fade opacity.
 * - `driftAt(scenes, index, t)` — a scene's camera-drift uniforms (zoom + lateral pan).
 * - `crossfadeAlpha(mix)` — the eased image-blend alpha (`shaders.ts`'s fragment shader mixes
 *   `uFrom`/`uTo` gamma-correctly by this amount).
 * - `steadyPacing(territories, t, rawRate, scale)` (ADR-029) — the `'crossfade'`/`'cut'`
 *   presentation regime and floor status for `'steady'`-mode playback, from `sceneTerritories(scenes)`
 *   (every scene's on-screen territory). `step`/`usePresentedSceneMix` take the regime as an
 *   optional last argument (default `'crossfade'`, i.e. today's behaviour unchanged).
 *   `MIN_CUT_DWELL_SECONDS` is its floor tunable, mirrored by value in `timeline/playback.ts`'s
 *   `advanceSteadyPlayhead`, which takes `sceneTerritories(scenes)`'s output structurally to floor
 *   the playhead's own rate.
 * - `steadyFrameRegime(territories, renderedT, rawRate, scale, seeked)` (ADR-029 re-review fix) —
 *   `steadyPacing` evaluated at the `t` a playback frame actually renders rather than the `t` it
 *   started at, and forced to `'crossfade'`/not-floored whenever `seeked` (the caller's own "did
 *   something other than my last advance move `t`" check) is true — see its own doc comment.
 */

export { REST_DRIFT, driftAt } from './drift'
export type { DriftUniforms } from './drift'
export { MAX_GAP_BONUS_SECONDS, scenePlaybackSegments, SCENE_DWELL_SECONDS } from './pacing'
export type { PlaybackSegment } from './pacing'
export { MIN_TRANSITION_SECONDS, step, usePresentedSceneMix } from './presentation'
export { captionOpacity, dominantScene, DISSOLVE_WIDTH, resolveAssetUrl, sceneAt, tAtLogP } from './scene'
export type { PresentationRegime, SceneMix } from './scene'
export { SceneView } from './SceneView'
export type { SceneViewProps } from './SceneView'
export { MIN_CUT_DWELL_SECONDS, sceneTerritories, steadyFrameRegime, steadyPacing, territoryAt } from './steadyPacing'
export type { SteadyPacing, SteadySceneTerritory } from './steadyPacing'
export { crossfadeAlpha } from './transition'
