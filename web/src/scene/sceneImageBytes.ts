/**
 * The encoded scene image bytes shared by both scene renderers (`lib/imagePrefetcher.ts`).
 * `prefetch.ts` decides what goes in; `SceneCanvasView` decodes from it through `textureCache`,
 * and `SceneFallbackView`'s `<img>` loads are then answered by the HTTP cache.
 */

import { createImagePrefetcher } from '@/lib/imagePrefetcher'

/** A full `prefetch.ts` plan and the pair are at most 19 scenes, ~8 MB at the ~430 KB average
 *  file (the largest is ~870 KB). Wanted scenes are never evicted, so this bounds only the bytes
 *  kept after a scene leaves the plan. */
export const SCENE_BYTES_BUDGET = 12 * 1024 * 1024

/** Few enough that a slow link's bandwidth goes to the nearest scenes first instead of being
 *  split across the whole plan, and that a newly needed pair shares it with at most three. */
export const SCENE_PREFETCH_CONCURRENCY = 3

/** Every scene texture decodes from here (`textureCache.ts`), so a prefetched scene costs no
 *  second request. */
export const sceneImageBytes = createImagePrefetcher({
  concurrency: SCENE_PREFETCH_CONCURRENCY,
  maxBytes: SCENE_BYTES_BUDGET,
})
