/**
 * Public API of the scene package (DESIGN §5 v1 note / ADR-009: flat-still cross-dissolve,
 * no depth/displacement yet).
 *
 * `<SceneView t scenes chapters assetBase renderCaption? className? />` — prop-driven, pure
 * in `t`. `scenes` and `chapters` are `Manifest.scenes` / `Manifest.chapters` as-is (scenes
 * sorted ascending by `t`); `assetBase` is `Manifest.assetBase`. `renderCaption`, if given,
 * is called with the dominant scene of the current dissolve and its return value is rendered
 * as-is — SceneView applies no positioning or styling to it.
 *
 * `sceneAt(scenes, chapters, t)` is the underlying pure sampler, exported for callers (e.g.
 * a minimap or a scrubber preview) that need the same from/to/mix without the component.
 */

export { dominantScene, resolveAssetUrl, sceneAt } from './scene'
export type { SceneMix } from './scene'
export { SceneView } from './SceneView'
export type { SceneViewProps } from './SceneView'
