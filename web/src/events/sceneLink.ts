/**
 * Which events the currently-captioned scene already names (ADR-022's `Scene.events`), so the
 * feed can skip them rather than repeat what the caption already says. Reuses `@/scene`'s own
 * pure `sceneAt`/`dominantScene` — the exact pair `SceneView` composes to pick which scene's
 * caption is showing (`dominantScene(sceneAt(scenes, t))`, see `Experience.tsx`'s
 * `renderCaption`) — rather than re-deriving "the current scene" a second way.
 */

import { dominantScene, sceneAt } from '@/scene'
import type { GeoTime } from '@/types/layer'
import type { Scene } from '@/types/manifest'

const EMPTY_IDS: ReadonlySet<string> = new Set()

export function sceneCaptionedEventIds(scenes: readonly Scene[], t: GeoTime): ReadonlySet<string> {
  if (scenes.length === 0) return EMPTY_IDS
  const scene = dominantScene(sceneAt(scenes, t))
  if (scene.events === undefined || scene.events.length === 0) return EMPTY_IDS
  return new Set(scene.events)
}
