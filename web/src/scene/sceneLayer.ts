/**
 * What one channel of the scene renderer draws for a scene (ADR-051): its full image once that
 * has loaded, its thumbnail, softened, until then. A scene with neither loaded has no layer, and
 * the renderer keeps whatever it last drew instead (`useScenePair`), so nothing is ever blank.
 */

import type { PresentationRegime } from './scene'

export interface SceneLayer<T> {
  /** The scene's full image URL, which identifies the scene whichever texture is drawn. */
  url: string
  full: T | null
  /** Kept alongside a loaded `full` so a sharpening can fade from it. */
  thumb: T | null
}

/** `url`'s layer from whichever of its textures have loaded, or `null` with neither. */
export function chooseSceneLayer<T>(url: string, full: T | undefined, thumb: T | undefined): SceneLayer<T> | null {
  if (full === undefined && thumb === undefined) return null
  return { url, full: full ?? null, thumb: thumb ?? null }
}

/**
 * How a channel that drew `previous` moves to `next`: a scene's full image replacing its own
 * thumbnail fades in under `'crossfade'` and cuts under `'cut'`. Anything else is `'none'` here:
 * a different scene is the presentation's own transition, not a sharpening.
 */
export function sharpening<T>(
  previous: SceneLayer<T> | null,
  next: SceneLayer<T>,
  regime: PresentationRegime,
): 'none' | 'fade' | 'cut' {
  if (previous === null || previous.url !== next.url) return 'none'
  if (previous.full !== null || next.full === null) return 'none'
  return regime === 'cut' ? 'cut' : 'fade'
}
