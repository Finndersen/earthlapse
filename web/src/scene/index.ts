/**
 * Public API of the scene package (DESIGN §5 v1 note / ADR-009: no depth/displacement;
 * ADR-012: whole-image crossfade with a minimum wall-clock duration).
 *
 * `<SceneView t scenes assetBase renderCaption? className? />` — prop-driven, pure in `t` (plus
 * the OS reduced-motion preference and the presentation catch-up's own pacing; see
 * `useReducedMotion` and `presentation.ts`). `scenes` is `Manifest.scenes` as-is (ascending
 * `t`); `assetBase` is `Manifest.assetBase`. `renderCaption`, if given, is called with the
 * dominant scene and its cross-fade opacity (`captionOpacity`); its return value is rendered
 * as-is, with no positioning or styling applied.
 *
 * The pure logic is exported separately for callers (a minimap, a scrubber preview, the
 * `timeline` package's playback pacing) that need it without the component — see each source
 * file's own doc comment for details:
 * - `sceneAt`/`DISSOLVE_WIDTH` — the from/to/mix *target* sampler and its dissolve-width tunable.
 * - `step`/`usePresentedSceneMix`/`MIN_TRANSITION_SECONDS` — rate-limits a *presented* `SceneMix`
 *   toward `sceneAt`'s target.
 * - `scenePlaybackSegments`/`SCENE_DWELL_SECONDS`/`MAX_GAP_BONUS_SECONDS` — the segments
 *   `timeline/playback.ts`'s `advancePlayhead` paces the playhead through in `'scenes'`-mode
 *   playback (ADR-016).
 * - `dominantScene`/`captionOpacity` — which scene reads as "current", and its caption fade.
 * - `driftAt` — a scene's camera-drift uniforms (zoom + lateral pan).
 * - `crossfadeAlpha` — the eased image-blend alpha `shaders.ts` mixes `uFrom`/`uTo` by.
 * - `steadyPacing`/`sceneTerritories`/`MIN_CUT_DWELL_SECONDS` (ADR-029) — the `'crossfade'`/
 *   `'cut'` regime and floor status for `'steady'`-mode playback; mirrored in
 *   `timeline/playback.ts`'s `advanceSteadyPlayhead`.
 * - `steadyFrameRegime` (ADR-029) — `steadyPacing` evaluated at the rendered `t`, forced to
 *   `'crossfade'` on a seek.
 */

export { REST_DRIFT, driftAt } from './drift'
export type { DriftUniforms } from './drift'
export { MAX_GAP_BONUS_SECONDS, scenePlaybackSegments, SCENE_DWELL_SECONDS } from './pacing'
export { playbackSecondsBetween, yearsForPlaybackSeconds } from './pacing'
export type { PlaybackSegment } from './pacing'
export { MIN_TRANSITION_SECONDS, step, usePresentedSceneMix } from './presentation'
export { captionOpacity, dominantScene, DISSOLVE_WIDTH, resolveAssetUrl, sceneAt, tAtLogP } from './scene'
export type { PresentationRegime, SceneMix } from './scene'
export { SceneView } from './SceneView'
export type { SceneViewProps } from './SceneView'
export { MIN_CUT_DWELL_SECONDS, sceneTerritories, steadyFrameRegime, steadyPacing, territoryAt } from './steadyPacing'
export type { SteadyPacing, SteadySceneTerritory } from './steadyPacing'
export { crossfadeAlpha } from './transition'
