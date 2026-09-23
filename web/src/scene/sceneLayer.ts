/**
 * What one channel of the scene renderer draws for a scene (ADR-051): its full image once that
 * has loaded, its thumbnail, softened, until then. A scene with neither loaded has no layer, and
 * the renderer keeps whatever it last drew instead (`useScenePair`), so nothing is ever blank. A
 * scene newly on screen waits a short grace for its full image before settling for its thumbnail.
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

/** How long a newly requested scene waits for its full image before binding on its thumbnail:
 *  about one fetch-and-decode on a fast link, short enough to read as a response to the click. */
export const FULL_IMAGE_GRACE_MS = 300

/** A request arriving this soon after the previous one is playback or a scrub moving faster than
 *  the grace could pay for: holding the picture for the grace would cost over half its time up. */
export const RAPID_REQUEST_MS = 2 * FULL_IMAGE_GRACE_MS

export interface GraceWait {
  /** The grace has run out for this request. */
  elapsed: boolean
  /** Since the request before this one; `Infinity` for the first. */
  sincePreviousRequestMs: number
}

/** Whether a thumbnail may be drawn for a scene not already on screen yet, or it waits. */
export function thumbnailAllowed({ elapsed, sincePreviousRequestMs }: GraceWait): boolean {
  return elapsed || sincePreviousRequestMs < RAPID_REQUEST_MS
}

/**
 * Whether the requested `from`/`to` layers replace the `bound` ones now. Never with an end that
 * has neither texture (nothing is ever blank); always for the first pair, or one drawn in full.
 * An end showing a scene not already on screen on its thumbnail waits out the grace instead, so a
 * deliberate jump whose full image arrives in time transitions once, straight to it.
 */
export function bindsNow<T>(
  bound: { from: SceneLayer<T>; to: SceneLayer<T> } | null,
  from: SceneLayer<T> | null,
  to: SceneLayer<T> | null,
  wait: GraceWait,
): boolean {
  if (from === null || to === null) return false
  if (bound === null || thumbnailAllowed(wait)) return true
  const onScreen = (layer: SceneLayer<T>): boolean => layer.url === bound.from.url || layer.url === bound.to.url
  return [from, to].every((layer) => layer.full !== null || onScreen(layer))
}
